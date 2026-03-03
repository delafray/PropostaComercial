import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { deletePhotoStorageFiles } from '../services/api/photoService';
import { Photo, Tag, TagCategory } from '../types';
import { Button, Card, Input, LoadingSpinner, Modal } from '../components/UI';
import { AlertModal, AlertType } from '../components/AlertModal';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

import {
  MAX_DIMENSION,
  THUMB_SIZE,
  QUALITY,
  dataURLtoBlob,
  generateThumbnail,
  extractInstagramShortcode,
  extractYouTubeId,
  fetchInstagramThumbnail,
  fetchYouTubeThumbnail,
  processAndCompressImage,
  compressExternalImage
} from '../src/utils/imageUtils';
import { seededShuffle } from '../src/utils/mathUtils';
import { usePhotoFilters } from '../src/hooks/usePhotoFilters';
import { usePdfExport } from '../src/hooks/usePdfExport';



const PHOTOS_PER_PAGE = 24;

const Photos: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [photoIndex, setPhotoIndex] = useState<Array<{ id: string; name: string; tagIds: string[]; userId: string; videoUrl?: string; createdAt: string }>>([]);
  const [hydratedPhotos, setHydratedPhotos] = useState<Photo[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [categories, setCategories] = useState<TagCategory[]>([]);

  const {
    searchTerm, setSearchTerm,
    selectedTagIds, setSelectedTagIds,
    onlyMine, setOnlyMine,
    selectedUserId, setSelectedUserId,
    sortByDate, setSortByDate,
    filteredResult,
    toggleFilterTag,
    clearAllFilters
  } = usePhotoFilters({ photoIndex, tags, categories });

  const aptForPdfCount = useMemo(() => {
    return filteredResult.ids.length;
  }, [filteredResult.ids]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);

  const [pdfLimit, setPdfLimit] = useState<number>(30);
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null);

  const [usersWithPhotos, setUsersWithPhotos] = useState<Array<{ id: string; name: string }>>([]);
  const [allUsers, setAllUsers] = useState<Array<{ id: string; name: string }>>([]); // For the author dropdown
  const [selectedExportIds, setSelectedExportIds] = useState<Set<string>>(new Set());
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [tagFontSize, setTagFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('tagFontSize');
    return saved ? Math.max(7, Math.min(14, parseInt(saved, 10))) : 9;
  });
  // Persist zoom preference
  useEffect(() => {
    localStorage.setItem('tagFontSize', tagFontSize.toString());
  }, [tagFontSize]);


  // Alert State
  const [alertState, setAlertState] = useState<{ isOpen: boolean; title: string; message: string; type: AlertType; onConfirm?: () => void }>({ isOpen: false, title: '', message: '', type: 'info' });
  const showAlert = (title: string, message: string, type: AlertType = 'info', onConfirm?: () => void) => setAlertState({ isOpen: true, title, message, type, onConfirm });


  // PDF Actions Modal state
  const [pdfActionModal, setPdfActionModal] = useState<{ isOpen: boolean; blob: Blob | null; fileName: string }>({
    isOpen: false, blob: null, fileName: ''
  });
  const onPdfReady = (blob: Blob, fileName: string) => {
    setPdfActionModal({ isOpen: true, blob, fileName });
  };

  // ─── Fullscreen photo lightbox ────────────────────────────────────────────
  const [fsUrl, setFsUrl] = useState<string | null>(null);
  const [fsZoom, setFsZoom] = useState(1);
  const [fsPan, setFsPan] = useState({ x: 0, y: 0 });
  const [fsIsLandscape, setFsIsLandscape] = useState<boolean | null>(null);
  const [fsScreenLandscape, setFsScreenLandscape] = useState(() => window.innerWidth > window.innerHeight);
  const fsOverlayRef = useRef<HTMLDivElement>(null);
  const fsGesture = useRef<{ dist?: number; zoom?: number; lastX?: number; lastY?: number }>({});
  const fsLiveRef = useRef({ zoom: 1, panX: 0, panY: 0 });

  // Sync live ref so non-React touch handler can read latest values
  useEffect(() => { fsLiveRef.current = { zoom: fsZoom, panX: fsPan.x, panY: fsPan.y }; }, [fsZoom, fsPan]);

  const openFullscreen = useCallback(async (url: string) => {
    setFsUrl(url);
    setFsZoom(1);
    setFsPan({ x: 0, y: 0 });
    setFsIsLandscape(null);
    try { await document.documentElement.requestFullscreen?.(); } catch { }
  }, []);

  const closeFullscreen = useCallback(() => {
    setFsUrl(null);
    setFsZoom(1);
    setFsPan({ x: 0, y: 0 });
    setFsIsLandscape(null);
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { }
    try { (screen.orientation as any)?.unlock?.(); } catch { }
  }, []);

  // Track screen orientation changes
  useEffect(() => {
    if (!fsUrl) return;
    const update = () => setFsScreenLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('orientationchange', update); };
  }, [fsUrl]);

  // When Android's back button exits fullscreen (fullscreenchange fires, NOT popstate),
  // close the lightbox overlay so the user returns to the preview popup.
  useEffect(() => {
    if (!fsUrl) return;
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        // Fullscreen was exited externally (back button) — close overlay
        setFsUrl(null);
        setFsZoom(1);
        setFsPan({ x: 0, y: 0 });
        setFsIsLandscape(null);
        try { (screen.orientation as any)?.unlock?.(); } catch { }
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [fsUrl]);

  // Detect image orientation and try to lock screen orientation (somente no celular)
  const handleFsImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    const landscape = naturalWidth > naturalHeight;
    setFsIsLandscape(landscape);
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      try { (screen.orientation as any)?.lock?.(landscape ? 'landscape' : 'portrait').catch(() => { }); } catch { }
    }
  }, []);

  // Imperative non-passive touch handler (React synthetic events are passive by default)
  useEffect(() => {
    const el = fsOverlayRef.current;
    if (!el || !fsUrl) return;

    const dist = (t: TouchList) => {
      const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        fsGesture.current = { dist: dist(e.touches), zoom: fsLiveRef.current.zoom };
      } else {
        fsGesture.current = { lastX: e.touches[0].clientX, lastY: e.touches[0].clientY, zoom: fsLiveRef.current.zoom };
      }
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const { zoom: startZoom, dist: startDist, lastX, lastY } = fsGesture.current;
      if (e.touches.length === 2 && startDist != null) {
        const newZoom = Math.min(10, Math.max(1, startZoom! * (dist(e.touches) / startDist)));
        setFsZoom(newZoom);
        fsLiveRef.current.zoom = newZoom;
      } else if (e.touches.length === 1 && lastX != null) {
        const dx = e.touches[0].clientX - lastX, dy = e.touches[0].clientY - lastY!;
        fsGesture.current.lastX = e.touches[0].clientX;
        fsGesture.current.lastY = e.touches[0].clientY;
        setFsPan(p => ({ x: p.x + dx / fsLiveRef.current.zoom, y: p.y + dy / fsLiveRef.current.zoom }));
      }
    };

    const onEnd = () => {
      fsGesture.current = {};
      setFsZoom(z => { if (z < 1.05) { setFsPan({ x: 0, y: 0 }); return 1; } return z; });
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false }); // non-passive → preventDefault works
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [fsUrl]);

  // Desktop wheel zoom
  const handleFsWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setFsZoom(z => Math.min(10, Math.max(1, z - e.deltaY * 0.001 * z)));
  }, []);

  // CSS counter-rotation: if image orientation doesn't match screen orientation, rotate 90deg (apenas no celular)
  const fsNeedsRotation = typeof window !== 'undefined' && window.innerWidth < 768 && fsIsLandscape !== null && fsIsLandscape !== fsScreenLandscape;


  const [videoPreviewDataUrl, setVideoPreviewDataUrl] = useState<string>(''); // Compressed thumbnail preview for video mode
  const [fetchingThumbnail, setFetchingThumbnail] = useState(false);

  const {
    exportProgress,
    isExporting,
    handleExportPDF
  } = usePdfExport({
    filteredResult,
    selectedExportIds,
    setSelectedExportIds,
    pdfLimit,
    tags,
    showAlert,
    onPdfReady
  });


  // Pagination state based on filtered results
  const [displayCount, setDisplayCount] = useState(PHOTOS_PER_PAGE);
  const [gridCols, setGridCols] = useState(window.innerWidth < 640 ? 2 : 5);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 640) setGridCols(2);
      else if (width < 1024) setGridCols(3);
      else if (width < 1280) setGridCols(4);
      else setGridCols(5);
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initialize on mount

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [formData, setFormData] = useState({
    name: '',
    url: '',
    thumbnailUrl: '',
    tagIds: [] as string[],
    localPath: '',
    storageLocation: '', // Servidor ou HD original
    videoUrl: '', // Link original do Instagram
    userId: '', // Author
    selectedFile: null as File | null
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      if (!user?.id) {
        console.warn("User ID not found, skipping fetch");
        return;
      }

      console.log("Fetching gallery data for user:", user.id);

      const [index, t, c, u, allU, configLimit] = await Promise.all([
        api.getPhotoIndex(user.id, onlyMine),
        api.getTags(user.id),
        api.getTagCategories(user.id),
        api.getUsersWithPhotos(),
        api.getUsers(),
        api.getSystemConfig('pdf_limit')
      ]);

      if (configLimit) {
        const parsedLimit = parseInt(configLimit);
        if (!isNaN(parsedLimit)) setPdfLimit(parsedLimit);
      }

      console.log(`Fetch success: ${index.length} photos, ${t.length} tags`);

      setPhotoIndex(index);
      setTags(t);
      setCategories(c.filter(cat => cat.name !== '__SYSCONFIG__').sort((a, b) => (a.order - b.order) || (a.createdAt || '').localeCompare(b.createdAt || '')));
      setUsersWithPhotos(u);
      setAllUsers(allU);
    } catch (err) {
      console.error("Critical error in fetchData:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user?.id, onlyMine]);

  // Reset pagination count when filter changes
  useEffect(() => {
    setDisplayCount(PHOTOS_PER_PAGE);
  }, [filteredResult.ids]);

  // --- HYDRATION LOGIC (Fetch full photo details for visible IDs) ---

  const visibleIds = useMemo(() => {
    return filteredResult.ids.slice(0, displayCount);
  }, [filteredResult.ids, displayCount]);

  useEffect(() => {
    let isMounted = true;

    if (visibleIds.length === 0) {
      setHydratedPhotos([]);
      return;
    }

    const loadVisiblePhotos = async () => {
      // Determine which IDs we don't have yet in hydratedPhotos
      const existingMap = new Map(hydratedPhotos.map(p => [p.id, p]));
      const newIds = visibleIds.filter(id => !existingMap.has(id));

      if (newIds.length === 0) {
        // We have everyone, just ensure the order and subset are correct
        const ordered = visibleIds.map(id => existingMap.get(id)).filter((p): p is Photo => !!p);

        // Only update if mounted and the list is actually different
        if (isMounted) {
          if (ordered.length !== hydratedPhotos.length ||
            ordered.some((p, i) => p.id !== hydratedPhotos[i].id)) {
            setHydratedPhotos(ordered);
          }
        }
        return;
      }

      setLoadingMore(true);
      try {
        const newPhotos = await api.getPhotosByIds(newIds);

        if (!isMounted) return;

        const updatedMap = new Map(existingMap);
        newPhotos.forEach(p => updatedMap.set(p.id, p));

        const finalOrdered = visibleIds.map(id => updatedMap.get(id)).filter((p): p is Photo => !!p);
        setHydratedPhotos(finalOrdered);
      } catch (err) {
        console.error("Hydration error:", err);
      } finally {
        if (isMounted) setLoadingMore(false);
      }
    };

    loadVisiblePhotos();

    return () => {
      isMounted = false;
    };
  }, [visibleIds]); // visibleIds captures changes in filteredResult.ids and displayCount

  const loadMore = () => {
    if (displayCount < filteredResult.ids.length) {
      setDisplayCount(prev => prev + PHOTOS_PER_PAGE);
    }
  };

  // --- HANDLERS ---



  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessingImage(true);
    try {
      const compressedUrl = await processAndCompressImage(file);

      setFormData(prev => ({
        ...prev,
        url: compressedUrl,
        name: prev.name || file.name.split('.')[0],
        localPath: prev.localPath || '',
        selectedFile: file
      }));
    } finally {
      setProcessingImage(false);
    }
  };

  const handleOpenModal = (photo: Photo | null = null) => {
    if (photo) {
      setEditingPhoto(photo);
      setFormData({
        name: photo.name,
        url: photo.url,
        thumbnailUrl: photo.thumbnailUrl || '',
        tagIds: photo.tagIds || [],
        localPath: photo.localPath || '',
        storageLocation: photo.storageLocation || '',
        videoUrl: photo.videoUrl || '',
        userId: photo.userId, // Pass the selected author
        selectedFile: null
      });
    } else {
      setEditingPhoto(null);
      setFormData({
        name: '',
        url: '',
        thumbnailUrl: '',
        tagIds: [],
        localPath: '',
        storageLocation: '',
        videoUrl: '',
        userId: user?.id || '', // Default to current user
        selectedFile: null
      });
    }
    setVideoPreviewDataUrl(photo && photo.videoUrl ? photo.url : '');
    setIsModalOpen(true);
  };

  const handleOpenPreview = (photo: Photo) => {
    setPreviewPhoto(photo);
    setIsPreviewOpen(true);
  };

  const handleFetchThumbnail = async () => {
    const url = formData.videoUrl.trim();
    if (!url) return;

    const instagramShortcode = extractInstagramShortcode(url);
    const youtubeId = extractYouTubeId(url);

    if (!instagramShortcode && !youtubeId) {
      showAlert('Link inválido', 'O link não parece ser um Reel do Instagram ou um vídeo do YouTube. Verifique o URL e tente novamente.', 'error');
      return;
    }

    setFetchingThumbnail(true);
    setVideoPreviewDataUrl('');

    try {
      let ogImageUrl: string | null = null;

      if (instagramShortcode) {
        ogImageUrl = await fetchInstagramThumbnail(url);
      } else if (youtubeId) {
        ogImageUrl = await fetchYouTubeThumbnail(url);
      }

      if (!ogImageUrl) {
        showAlert('Capa não encontrada', 'Não foi possível buscar a capa. Certifique-se que o vídeo é público e o link está correto.', 'error');
        return;
      }

      // Compress the image via canvas (always attempt for YouTube too to ensure local storage version)
      try {
        const compressed = await compressExternalImage(`https://api.allorigins.win/raw?url=${encodeURIComponent(ogImageUrl)}`);
        setVideoPreviewDataUrl(compressed);
      } catch {
        // If allorigins fails, try YouTube directly (YouTube usually allows direct img crossOrigin)
        if (youtubeId) {
          try {
            const compressed = await compressExternalImage(ogImageUrl);
            setVideoPreviewDataUrl(compressed);
          } catch {
            setVideoPreviewDataUrl(ogImageUrl);
          }
        } else {
          setVideoPreviewDataUrl(ogImageUrl);
        }
      }
    } finally {
      setFetchingThumbnail(false);
    }
  };



  const selectAllFiltered = () => {
    setSelectedExportIds(new Set(filteredResult.ids));
  };

  const handleClearSelection = () => {
    setSelectedExportIds(new Set());
  };

  const toggleSelection = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedExportIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };



  const toggleModalTag = (tagId: string) => {
    setFormData(prev => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId) ? prev.tagIds.filter(id => id !== tagId) : [...prev.tagIds, tagId]
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // Detect video mode: category order=1 and tag order=1 selected
    const cat1 = categories.find(c => c.order === 1);
    const videoTag = cat1 ? tags.find(t => t.categoryId === cat1.id && t.order === 1) : null;
    const isVideoMode = !!(videoTag && formData.tagIds.includes(videoTag.id));

    if (isVideoMode) {
      if (!formData.videoUrl.trim()) {
        showAlert('Link obrigatório', 'Cole o link do Instagram Reel para continuar.', 'error');
        return;
      }
    } else {
      if (!formData.url) {
        showAlert('Imagem obrigatória', 'Escolha uma foto para continuar.', 'error');
        return;
      }
    }

    // Validation for Mandatory Categories (with Peer support)
    const processedGroups = new Set<string>();
    const missingRequirements: string[] = [];

    categories.filter(cat => cat.isRequired).forEach(cat => {
      const peerGroupIds = [cat.id, ...(cat.peerCategoryIds || [])].sort();
      const groupKey = peerGroupIds.join('|');
      if (processedGroups.has(groupKey)) return;
      processedGroups.add(groupKey);
      const allTagsInGroup = tags.filter(t => peerGroupIds.includes(t.categoryId)).map(t => t.id);
      const isSatisfied = formData.tagIds.some(id => allTagsInGroup.includes(id));
      if (!isSatisfied) {
        const groupNames = categories.filter(c => peerGroupIds.includes(c.id)).map(c => `"${c.name}"`).join(' ou ');
        missingRequirements.push(groupNames);
      }
    });

    if (missingRequirements.length > 0) {
      const list = missingRequirements.join('\n- ');
      showAlert('Campos Obrigatórios', `A seleção nos seguintes grupos/níveis é obrigatória:\n- ${list}`, 'error');
      return;
    }

    setSaving(true);
    try {
      let finalUrl = formData.url;
      let finalThumbUrl = formData.thumbnailUrl;
      let finalVideoUrl = formData.videoUrl;

      if (isVideoMode && formData.videoUrl.trim()) {
        if (!videoPreviewDataUrl) {
          showAlert('Capa obrigatória', 'Clique em "Buscar Capa" para validar e carregar a imagem do vídeo antes de salvar.', 'error');
          setSaving(false);
          return;
        }

        const isFreshCapture = videoPreviewDataUrl.startsWith('data:');

        if (isFreshCapture) {
          setProcessingImage(true);
          // Upload the pre-fetched and compressed thumbnail to Supabase Storage
          try {
            const thumbBlob = dataURLtoBlob(videoPreviewDataUrl);
            const thumbFile = new File([thumbBlob], `video_thumb_${Date.now()}.jpg`, { type: 'image/jpeg' });
            finalUrl = await api.uploadPhotoFile(user.id, thumbFile);
            finalThumbUrl = finalUrl;
          } catch {
            // Fallback: store the data URL directly (not ideal but functional)
            finalUrl = videoPreviewDataUrl;
            finalThumbUrl = videoPreviewDataUrl;
          }
          setProcessingImage(false);
        } else {
          // If not a fresh capture, we use the existing URL (which was set to videoPreviewDataUrl in handleOpenModal)
          finalUrl = formData.url;
          finalThumbUrl = formData.thumbnailUrl;
        }
      } else if (formData.selectedFile) {
        // Normal photo upload
        const blob = dataURLtoBlob(formData.url);
        const fileToUpload = new File([blob], formData.selectedFile.name, { type: blob.type });
        finalUrl = await api.uploadPhotoFile(user.id, fileToUpload);
        const thumbDataUrl = await generateThumbnail(formData.selectedFile);
        const thumbBlob = dataURLtoBlob(thumbDataUrl);
        const thumbToUpload = new File([thumbBlob], `thumb_${formData.selectedFile.name}`, { type: thumbBlob.type });
        finalThumbUrl = await api.uploadPhotoFile(user.id, thumbToUpload);
      }

      if (!user?.id) return;
      const saveData = { ...formData, url: finalUrl, thumbnailUrl: finalThumbUrl, videoUrl: finalVideoUrl };
      if (editingPhoto) {
        await api.updatePhoto(editingPhoto.id, saveData);
        // Invalidate hydration cache for this specific photo
        setHydratedPhotos(prev => prev.filter(p => p.id !== editingPhoto.id));
        // Se um novo arquivo foi enviado, remove os arquivos antigos do Storage
        // para não acumular arquivos órfãos consumindo cota
        if (formData.selectedFile) {
          await deletePhotoStorageFiles([editingPhoto.url, editingPhoto.thumbnailUrl]);
        }
      } else {
        await api.createPhoto(user.id, saveData);
      }

      setIsModalOpen(false);
      await fetchData();
    } catch (err: any) {
      console.error(err);
      showAlert('Erro Operacional', 'Erro ao salvar: ' + err.message, 'error');
    } finally {
      setSaving(false);
      setProcessingImage(false);
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    showAlert('Excluir Arquivo', 'Deseja excluir permanentemente este arquivo multimídia? Esta ação não pode ser desfeita.', 'confirm', async () => {
      await api.deletePhoto(id);
      fetchData();
    });
  };

  // Helper: can the current user edit/delete a specific photo?
  const canEditPhoto = (photo: { userId?: string }) => {
    if (!user) return false;
    if (user.isAdmin) return true; // Admins can edit any photo
    if (user.isVisitor) return false; // Visitors cannot edit
    if (user.isProjetista) return photo.userId === user.id; // Projetista can only edit their own
    return photo.userId === user.id; // Fallback for other non-admins
  };

  const copyToClipboard = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    showAlert('Sucesso', 'Link copiado para a área de transferência!', 'success');
  };

  const effectiveSelectionCount = useMemo(() => {
    if (selectedExportIds.size === 0) return 0;
    return filteredResult.ids.filter(id => selectedExportIds.has(id)).length;
  }, [selectedExportIds, filteredResult.ids]);

  // --- PDF Action Buttons Framework ---
  // Standardizes colors for Limpar, Selecionar/Tudo, and Gerar PDF buttons based on selection count.
  const getPdfButtonClasses = (count: number, limit: number) => {
    if (count === 0) {
      // Estado inicial: azul claro / texto azul escuro / cursor ponteiro / hover mais escuro
      return '!bg-blue-100 !text-blue-700 !border-blue-200 shadow-none hover:!bg-blue-200 transition-colors cursor-pointer';
    }

    if (count > limit) {
      // Acima do limite: vermelho forte
      return '!bg-red-600 !text-white !border-red-600 shadow-red-500/30 hover:!bg-red-700 cursor-pointer';
    }

    // Dentro do limite: azul forte
    return '!bg-blue-600 !text-white !border-blue-600 shadow-blue-500/30 hover:!bg-blue-700 cursor-pointer';
  };

  // Tudo button: always active blue (can always select-all), only red when over limit
  const getTudoButtonClasses = (count: number, limit: number) => {
    if (count > limit) {
      return '!bg-red-600 !text-white !border-red-600 shadow-red-500/30 hover:!bg-red-700 cursor-pointer';
    }
    return '!bg-blue-600 !text-white !border-blue-600 shadow-blue-500/30 hover:!bg-blue-700 cursor-pointer';
  };

  const headerActions = (
    <div className="flex gap-2">
      {/* Grid Zoom Slider */}
      <div className="flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 rounded-xl shadow-sm">
        <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
        </svg>
        <input
          type="range"
          min="2"
          max="10"
          value={gridCols}
          onChange={(e) => setGridCols(parseInt(e.target.value))}
          className="w-24 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          title="Zoom da Grade"
        />
        <span className="text-[10px] font-bold text-slate-500 w-4">{gridCols}</span>
      </div>


      {/* Botão de Redundância: Gerar PDF */}
      <Button
        variant="primary"
        onClick={() => {
          if (effectiveSelectionCount > 0) {
            handleExportPDF();
          }
        }}
        className={`py-2 px-4 text-xs font-bold transition-all whitespace-nowrap shadow-sm border ${getPdfButtonClasses(effectiveSelectionCount, pdfLimit)}`}
      >
        Gerar PDF ({effectiveSelectionCount})
      </Button>

      {/* Select All Button - Always visible, disabled if no results */}
      <Button
        variant="primary"
        onClick={() => {
          if (filteredResult.ids.length > 0) {
            selectAllFiltered();
          }
        }}
        className={`py-2 px-4 text-xs font-bold transition-all whitespace-nowrap shadow-sm border ${filteredResult.ids.length === 0 ? 'opacity-30 cursor-not-allowed bg-slate-50' : getPdfButtonClasses(effectiveSelectionCount, pdfLimit)}`}
      >
        {effectiveSelectionCount > 0 && effectiveSelectionCount === filteredResult.ids.length ? 'Todos Selecionados' : `Selecionar Tudo (${filteredResult.ids.length})`}
      </Button>

      {/* Clear All Button - Always visible, disabled if no filters/selections active */}
      {(() => {
        const hasActiveFilters = selectedTagIds.length > 0 || selectedExportIds.size > 0 || searchTerm !== '' || ((user?.isAdmin || user?.isProjetista) && (selectedUserId !== 'all' || onlyMine));
        return (
          <Button
            variant="primary"
            onClick={() => {
              if (hasActiveFilters) {
                setSelectedTagIds([]);
                setSelectedExportIds(new Set());
                setSearchTerm('');
                if (user?.isAdmin || user?.isProjetista) {
                  setOnlyMine(false);
                  setSelectedUserId('all');
                }
              }
            }}
            className={`py-2 px-4 text-xs font-bold transition-all whitespace-nowrap shadow-sm border ${getPdfButtonClasses(effectiveSelectionCount, pdfLimit)}`}
          >
            Limpar Tudo
          </Button>
        );
      })()}


    </div>
  );

  const mobileSidebarContent = (
    <div className="flex flex-col gap-2">
      {/* Novo Registro — primeiro destaque */}
      {!user?.isVisitor && (
        <Button onClick={() => handleOpenModal()} variant="danger" className="w-full py-2 text-xs font-bold shadow-sm">
          + Novo Registro
        </Button>
      )}

      {/* Search bar */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          type="text"
          placeholder="Pesquisar..."
          className="w-full bg-slate-100 border-none rounded-xl py-2 pl-9 pr-3 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all outline-none"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {(user?.isAdmin || user?.isProjetista) && (
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200">
          <input type="checkbox" id="onlyMineSidebar" checked={onlyMine}
            onChange={e => { setOnlyMine(e.target.checked); if (e.target.checked) setSelectedUserId('all'); }}
            className="w-4 h-4 text-blue-600 rounded border-slate-300"
          />
          <label htmlFor="onlyMineSidebar" className="text-xs font-medium text-slate-600 cursor-pointer select-none">Apenas meus registros</label>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200">
        <input type="checkbox" id="sortByDateSidebar" checked={sortByDate} onChange={e => setSortByDate(e.target.checked)}
          className="w-4 h-4 text-blue-600 rounded border-slate-300"
        />
        <label htmlFor="sortByDateSidebar" className="text-xs font-medium text-slate-600 cursor-pointer select-none">Ordem de Cadastro</label>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider whitespace-nowrap">Autor:</label>
        <select value={selectedUserId} onChange={(e) => { setSelectedUserId(e.target.value); if (e.target.value !== 'all') setOnlyMine(false); }}
          className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer flex-1">
          <option value="all">Todos os Autores</option>
          {usersWithPhotos.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
    </div>
  );

  // Mobile back button: close open modals instead of showing exit dialog
  const handleMobileBack = (): boolean => {
    if (fsUrl) { closeFullscreen(); return true; }
    if (pdfActionModal.isOpen) { setPdfActionModal(prev => ({ ...prev, isOpen: false })); return true; }
    if (isPreviewOpen) { setIsPreviewOpen(false); return true; }
    if (isModalOpen) { setIsModalOpen(false); return true; }
    return false;
  };

  return (
    <Layout title="Galeria Estruturada" headerActions={headerActions} mobileSidebarContent={mobileSidebarContent} onMobileBack={handleMobileBack}>
      <>
        <div className="flex flex-col gap-1 md:gap-2">
          <Card className="p-1 md:p-3">
            <div className="hidden md:flex flex-col md:flex-row gap-4 items-center justify-between mb-2 border-b border-slate-100 pb-2">
              <div className="flex-1 w-full max-w-md flex gap-2">
                <div className="hidden md:flex flex-1 relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Pesquisar por nome ou etiqueta..."
                    className="w-full bg-slate-100 border-none rounded-2xl py-3 pl-11 pr-4 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>

              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(user?.isAdmin || user?.isProjetista) && (
                  <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200">
                    <input
                      type="checkbox"
                      id="onlyMine"
                      checked={onlyMine}
                      onChange={e => {
                        setOnlyMine(e.target.checked);
                        if (e.target.checked) setSelectedUserId('all');
                      }}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                    <label htmlFor="onlyMine" className="text-xs font-medium text-slate-600 cursor-pointer select-none">
                      Apenas meus registros
                    </label>
                  </div>
                )}

                <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-lg border border-slate-200">
                  <label htmlFor="userFilter" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Autor:</label>
                  <select
                    id="userFilter"
                    value={selectedUserId}
                    onChange={(e) => {
                      setSelectedUserId(e.target.value);
                      if (e.target.value !== 'all') setOnlyMine(false);
                    }}
                    className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                  >
                    <option value="all">Todos os Autores</option>
                    {usersWithPhotos.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>

                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200" title="Ordena do mais recente para o mais antigo">
                  <input
                    type="checkbox"
                    id="sortByDate"
                    checked={sortByDate}
                    onChange={e => setSortByDate(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  />
                  <label htmlFor="sortByDate" className="text-xs font-medium text-slate-600 cursor-pointer select-none">
                    Ordem de Cadastro
                  </label>
                </div>

                {!user?.isVisitor && (
                  <Button
                    onClick={() => handleOpenModal()}
                    variant="danger"
                    className="hidden md:block py-1.5 md:py-1.5 px-3 md:px-4 text-[10px] md:text-xs font-bold shadow-sm hover:scale-105 transition-transform shrink-0 whitespace-nowrap"
                  >
                    + Novo Registro
                  </Button>
                )}
              </div>
            </div>


            <div className="space-y-1 mt-2">
              {/* Mobile-only: Galeria title + photo count */}
              <div className="md:hidden flex items-center gap-2 mb-1">
                <span className="text-sm font-black text-slate-700 uppercase tracking-tight shrink-0">Galeria</span>
                <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {filteredResult.ids.length} registros
                </span>
                {/* Tag zoom controls */}
                <div className="flex items-center gap-1 bg-slate-100 rounded-lg px-1.5 py-0.5 ml-auto">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Zoom</span>
                  <button
                    onClick={() => setTagFontSize(s => Math.max(7, s - 1))}
                    className="w-6 h-6 flex items-center justify-center rounded bg-white border border-slate-200 text-slate-600 text-sm font-black hover:bg-blue-50 hover:text-blue-600 active:scale-95 transition-all"
                  >−</button>
                  <span className="text-[10px] font-bold text-slate-500 min-w-[20px] text-center">{tagFontSize}</span>
                  <button
                    onClick={() => setTagFontSize(s => Math.min(14, s + 1))}
                    className="w-6 h-6 flex items-center justify-center rounded bg-white border border-slate-200 text-slate-600 text-sm font-black hover:bg-blue-50 hover:text-blue-600 active:scale-95 transition-all"
                  >+</button>
                </div>
              </div>

              {/* Mobile: button to toggle filters. Desktop: static title */}
              <button
                className="md:hidden w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-all !bg-blue-600 !text-white !border-blue-600 hover:!bg-blue-700 border"
                onClick={() => setShowMobileFilters(!showMobileFilters)}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M3 4h18M3 12h18m-7 8h7" /></svg>
                  Filtro Hierárquico
                </div>
                <svg className={`w-3 h-3 transition-transform ${showMobileFilters ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
              </button>
              <h3 className="hidden md:flex text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] items-center gap-2">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M3 4h18M3 12h18m-7 8h7" /></svg>
                Matriz de Filtragem Hierárquica
              </h3>
              <div className={`${showMobileFilters ? 'flex' : 'hidden md:flex'} flex-col gap-0.5 animate-in fade-in duration-300`}>
                {(() => {
                  const maxSelectedOrder = selectedTagIds.length > 0 ? Math.max(...selectedTagIds.map(sid => {
                    const t = tags.find(tag => tag.id === sid);
                    const c = t ? categories.find(cat => cat.id === t.categoryId) : undefined;
                    return c ? c.order : 0;
                  })) : 0;

                  return categories.map((cat) => (
                    <div key={cat.id} className="group relative flex flex-col md:flex-row md:items-center bg-white border border-slate-200 rounded-xl px-1.5 md:px-3 py-0.5 transition-all hover:border-blue-400 hover:shadow-md">
                      <div className="md:w-36 flex-shrink-0 flex items-center gap-2 mb-1 md:mb-0 border-b md:border-b-0 md:border-r border-slate-100 pb-1 md:pb-0 md:pr-3">
                        <span className="w-5 h-5 bg-blue-600 text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-sm">
                          {cat.order}
                        </span>
                        <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-tight truncate">{cat.name}</h4>
                      </div>

                      <div className="flex-1 md:pl-4 flex flex-wrap gap-x-0.5 gap-y-0.5 md:gap-x-1.5 md:gap-y-1 py-0.5">
                        {tags.filter(t => t.categoryId === cat.id).map(tag => {
                          const isSelected = selectedTagIds.includes(tag.id);
                          const isAvailable = filteredResult.availableTagsByLevel[cat.order]?.has(tag.id);
                          const isLineage = !isSelected && filteredResult.activeLineageTags?.has(tag.id) && selectedTagIds.length > 0 && cat.order < maxSelectedOrder;

                          if (!isAvailable && !isSelected) return null;

                          let buttonClasses = 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-white hover:border-blue-400 hover:text-blue-600';
                          if (isSelected) {
                            buttonClasses = 'bg-blue-600 border-blue-600 text-white shadow-md scale-105';
                          } else if (isLineage) {
                            // Subtle green border and text, keeping the neutral background
                            buttonClasses = 'bg-slate-50 border-green-300 text-green-600 hover:bg-white hover:border-green-400 hover:text-green-700';
                          }

                          return (
                            <button
                              key={tag.id}
                              onClick={() => toggleFilterTag(tag.id)}
                              style={{
                                fontSize: `${tagFontSize}px`,
                                padding: `${Math.round(tagFontSize * 0.22)}px ${Math.round(tagFontSize * 0.55)}px`
                              }}
                              className={`rounded-full font-bold border transition-all flex items-center gap-1 ${buttonClasses}`}
                            >
                              {isSelected && <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg>}
                              {tag.name}
                            </button>
                          );
                        })}
                        {tags.filter(t => t.categoryId === cat.id).length === 0 && (
                          <span className="text-[9px] text-slate-300 italic">Sem tags</span>
                        )}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </Card>

          {
            loading ? <LoadingSpinner /> : (
              <div
                className="grid gap-1.5 md:gap-4 transition-all duration-300 ease-in-out"
                style={{
                  gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`
                }}
              >
                {hydratedPhotos.map((photo, idx) => (
                  <Card
                    key={photo.id}
                    className={`overflow-hidden group flex flex-col h-full hover:ring-2 transition-all cursor-pointer shadow-sm bg-white ${selectedExportIds.has(photo.id) ? 'ring-2 ring-blue-500 bg-blue-50/30' : 'hover:ring-blue-500'}`}
                    onClick={() => handleOpenPreview(photo)}
                    ref={idx === hydratedPhotos.length - 1 ? (el) => {
                      if (el) {
                        const observer = new IntersectionObserver((entries) => {
                          if (entries[0].isIntersecting && displayCount < filteredResult.ids.length && !loadingMore) {
                            loadMore();
                            observer.disconnect();
                          }
                        }, { threshold: 0.1 });
                        observer.observe(el);
                      }
                    } : undefined}
                  >
                    <div className="relative aspect-[4/3] bg-slate-50 overflow-hidden">
                      <img src={photo.thumbnailUrl || photo.url} alt={photo.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />


                      {/* Selection Checkbox */}
                      <div
                        className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center before:content-[''] before:absolute before:-inset-3 ${selectedExportIds.has(photo.id) ? 'bg-blue-600 border-blue-600' : 'bg-white/20 border-white/50 backdrop-blur-sm group-hover:bg-white/40'}`}
                        onClick={(e) => toggleSelection(e, photo.id)}
                      >
                        {selectedExportIds.has(photo.id) && (
                          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>

                      <div className="absolute top-2 right-2 flex gap-1">
                        {canEditPhoto(photo) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenModal(photo);
                            }}
                            className="hidden sm:block p-1.5 bg-blue-600/90 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:bg-blue-700"
                            title="Editar registro"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                        )}
                        {photo.localPath && (
                          <button onClick={(e) => copyToClipboard(e, photo.localPath!)} className="hidden sm:block p-1.5 bg-slate-800/90 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:bg-slate-900" title="Caminho local"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg></button>
                        )}
                        {/* Delete button moved to Lightbox Modal as requested */}
                        {/* Play — always visible, last = rightmost corner */}
                        {photo.videoUrl && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(photo.videoUrl, '_blank', 'noopener,noreferrer');
                            }}
                            className="p-1.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg transition-all shadow-lg hover:from-purple-700 hover:to-pink-700 hover:scale-110"
                            title="Abrir vídeo"
                          >
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="p-2 flex flex-col justify-center">
                      <h4 className="text-[10px] font-black text-slate-800 tracking-tight truncate">{photo.name}</h4>
                    </div>
                  </Card>
                ))}
              </div>
            )
          }

          {/* Mobile Sticky Bar */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-t border-slate-200 p-1.5 flex gap-1.5 shadow-[0_-8px_30px_rgb(0,0,0,0.12)]">
            {(() => {
              const hasActiveFilters = selectedTagIds.length > 0 || selectedExportIds.size > 0 || searchTerm !== '' || ((user?.isAdmin || user?.isProjetista) && (selectedUserId !== 'all' || onlyMine));
              return (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedTagIds([]);
                    setSelectedExportIds(new Set());
                    if (user?.isAdmin || user?.isProjetista) {
                      setOnlyMine(false);
                      setSelectedUserId('all');
                    }
                  }}
                  className={`flex-[0.6] min-w-0 px-1 h-9 text-[9px] font-black uppercase tracking-widest active:scale-95 transition-all border ${hasActiveFilters ? '!bg-blue-600 !text-white !border-blue-600 shadow-blue-500/30 hover:!bg-blue-700 cursor-pointer' : '!bg-blue-100 !text-blue-700 !border-blue-200 shadow-none hover:!bg-blue-200 transition-colors cursor-pointer'}`}
                >
                  Limpar
                </Button>
              );
            })()}
            <Button
              variant="outline"
              onClick={selectAllFiltered}
              className={`flex-[0.6] min-w-0 px-1 h-9 text-[9px] font-black uppercase tracking-widest active:scale-95 transition-all border ${getTudoButtonClasses(effectiveSelectionCount, pdfLimit)}`}
            >
              Tudo
            </Button>
            <Button
              onClick={() => {
                if (effectiveSelectionCount > 0 && !isExporting) {
                  handleExportPDF();
                }
              }}
              className={`flex-[1.8] min-w-0 whitespace-nowrap px-2 h-9 shadow-lg text-[10px] font-black uppercase tracking-widest transition-all border ${isExporting ? 'opacity-50 cursor-wait' : ''} ${getPdfButtonClasses(effectiveSelectionCount, pdfLimit)}`}
            >
              {isExporting ? 'Aguarde...' : `GERAR PDF (${effectiveSelectionCount})`}
            </Button>
          </div>

          {/* Extra bottom padding for mobile to not hide content behind sticky bar */}
          <div className="md:hidden h-20"></div>
          {loadingMore && <div className="py-8 text-center"><LoadingSpinner /></div>}
        </div>

        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={
            <div className="flex flex-col md:flex-row md:items-center gap-4 w-full min-w-0">
              <div className="flex items-center gap-4 flex-shrink-0">
                <span className="text-lg font-black text-slate-800 whitespace-nowrap">{editingPhoto ? 'EDITAR' : 'NOVO REGISTRO'}</span>
                <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>
                <div className="hidden lg:flex items-center text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">
                  <div className="w-1.5 h-4 bg-blue-600 rounded-full mr-2"></div>
                  Atribuição
                </div>
              </div>

              <div className="flex-1 flex gap-2 min-w-0">
                <input
                  placeholder="Título do Registro..."
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="flex-[1.5] min-w-0 bg-white border-2 border-blue-400 rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 shadow-sm outline-none transition-all"
                  required
                />
                <div className="hidden sm:flex flex-1 min-w-0 relative group items-center">
                  <input
                    placeholder="Caminho (Local)..."
                    value={formData.localPath}
                    onChange={e => setFormData({ ...formData, localPath: e.target.value })}
                    className="w-full min-w-0 bg-white border-2 border-blue-400 rounded-lg px-2.5 py-1 pr-8 text-[11px] font-mono text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 shadow-sm outline-none transition-all"
                  />
                  {formData.localPath && (
                    <button
                      type="button"
                      onClick={(e) => copyToClipboard(e, formData.localPath!)}
                      className="absolute right-1 p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="Copiar caminho local"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  )}
                </div>
                <input
                  placeholder="Servidor / HD..."
                  title="Servidor ou HD Externo onde está o arquivo original da foto/vídeo"
                  value={formData.storageLocation}
                  onChange={e => setFormData({ ...formData, storageLocation: e.target.value })}
                  className="hidden md:block flex-[0.8] min-w-0 bg-white border-2 border-slate-300 rounded-lg px-2.5 py-1 text-[11px] font-mono text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500 shadow-sm outline-none transition-all"
                />
              </div>
            </div>
          }
          maxWidth="max-w-[95vw]"
        >
          {(() => {
            // Compute video mode for the modal UI
            const cat1 = categories.find(c => c.order === 1);
            const videoTag = cat1 ? tags.find(t => t.categoryId === cat1.id && t.order === 1) : null;
            const isVideoMode = !!(videoTag && formData.tagIds.includes(videoTag.id));
            return (
              <form onSubmit={handleSave} className="flex flex-col gap-6 max-h-[85vh]">
                <div className="flex flex-col lg:flex-row gap-10 overflow-y-auto pr-4 pb-4 scrollbar-thin">
                  <div className="w-full lg:w-96 flex-shrink-0 space-y-6">
                    {/* Author Selection */}
                    <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2">Autoria do Registro</label>
                      <select
                        className="w-full rounded-xl border-slate-200 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-xs py-2 px-3 font-bold text-slate-700 bg-white"
                        value={formData.userId}
                        onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                      >
                        {allUsers.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.name} {u.id === user?.id ? '(Você)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Image Upload / Video Link - Conditional */}
                    <div className="space-y-3">
                      {isVideoMode ? (
                        // Video mode: show Instagram link input + fetch button + preview
                        <div className="space-y-3">
                          {/* Link input + fetch button */}
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                              <input
                                type="url"
                                placeholder="Link do Instagram (Reel) ou YouTube..."
                                value={formData.videoUrl}
                                onChange={e => { setFormData({ ...formData, videoUrl: e.target.value }); setVideoPreviewDataUrl(''); }}
                                className="flex-1 min-w-0 bg-white border border-purple-200 rounded-xl px-3 py-2 text-[11px] font-mono focus:ring-2 focus:ring-purple-400 outline-none transition-all placeholder:text-slate-300"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (formData.videoUrl.trim()) window.open(formData.videoUrl, '_blank', 'noopener,noreferrer');
                                }}
                                disabled={!formData.videoUrl.trim()}
                                className="px-3 py-2 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-xl hover:bg-slate-200 disabled:opacity-50 transition-all border border-slate-200"
                                title="Testar se o link abre corretamente"
                              >
                                🔗 Testar
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={handleFetchThumbnail}
                              disabled={!formData.videoUrl.trim() || fetchingThumbnail}
                              className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-[10px] font-black rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:from-purple-700 hover:to-pink-700 transition-all shadow-lg shadow-purple-500/20"
                            >
                              {fetchingThumbnail ? '⏳ Buscando Capa...' : (formData.url && isVideoMode ? '🔄 Atualizar Capa Automática' : '🔍 Buscar Capa Automaticamente')}
                            </button>
                          </div>

                          {/* Thumbnail preview area */}
                          <div className={`aspect-video rounded-2xl overflow-hidden border-2 border-dashed flex items-center justify-center transition-all ${videoPreviewDataUrl ? 'border-green-300 bg-green-50' : 'border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50'}`}>
                            {videoPreviewDataUrl ? (
                              <div className="relative w-full h-full group/vidprev">
                                <img src={videoPreviewDataUrl} alt="Capa do vídeo" className="w-full h-full object-cover" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="w-12 h-8 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20">
                                    <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                  </div>
                                </div>
                                <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
                                  <span className="bg-green-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full">
                                    {videoPreviewDataUrl.startsWith('data:') ? '✓ Capa capturada e comprimida' : '✓ Capa atual do registro'}
                                  </span>
                                  <button type="button" onClick={() => setVideoPreviewDataUrl('')} className="bg-black/50 text-white text-[9px] px-2 py-0.5 rounded-full">Trocar</button>
                                </div>
                              </div>
                            ) : fetchingThumbnail ? (
                              <div className="flex flex-col items-center gap-3 text-purple-500">
                                <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                                <span className="text-[10px] font-bold">Buscando capa...</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-3 p-6">
                                <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                </div>
                                <div className="flex flex-col items-center gap-2">
                                  <span className="text-[10px] font-black text-purple-700 uppercase tracking-widest text-center">Busque a capa ou suba manualmente</span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => document.getElementById('manual-video-thumb')?.click()}
                                      className="px-3 py-1.5 bg-white border border-purple-200 text-purple-600 text-[9px] font-black rounded-lg hover:bg-purple-50 transition-all flex items-center gap-1.5"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                      UPLOAD MANUAL
                                    </button>
                                    <input
                                      id="manual-video-thumb"
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                          setProcessingImage(true);
                                          try {
                                            const compressed = await processAndCompressImage(file);
                                            setVideoPreviewDataUrl(compressed);
                                          } finally {
                                            setProcessingImage(false);
                                          }
                                        }
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        // Photo mode: normal image upload
                        <div className="flex flex-col gap-2">
                          <div className={`aspect-video lg:aspect-square bg-slate-50 border-2 border-dashed rounded-3xl overflow-hidden flex items-center justify-center relative transition-all duration-300 ${formData.url ? 'border-blue-200' : 'border-slate-200 hover:border-blue-400'}`}>
                            {formData.url ? (
                              <div className="w-full h-full relative group/preview">
                                <img src={formData.url} className="w-full h-full object-cover" alt="Preview" />
                                {!processingImage && (
                                  <div className="absolute inset-0 bg-black/40 backdrop-blur-sm opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center">
                                    <label className="cursor-pointer bg-white px-6 py-2 rounded-xl font-black text-[10px] uppercase shadow-2xl hover:bg-slate-100 transition-colors">
                                      Trocar Imagem
                                      <input type="file" className="sr-only" accept="image/*" onChange={handleFileUpload} disabled={processingImage} />
                                    </label>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <label className="cursor-pointer p-10 text-center w-full h-full flex flex-col items-center justify-center">
                                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4 transition-all hover:scale-110 shadow-sm"><svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg></div>
                                <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Upload Imagem</span>
                                <input type="file" className="sr-only" accept="image/*" onChange={handleFileUpload} disabled={processingImage} />
                              </label>
                            )}
                          </div>
                          {editingPhoto && formData.url && (
                            <div className="flex justify-center mt-1">
                              <label className="cursor-pointer px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors border border-slate-200 flex items-center gap-2 shadow-sm">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                Alterar Imagem Deste Registro
                                <input type="file" className="sr-only" accept="image/*" onChange={handleFileUpload} disabled={processingImage} />
                              </label>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 space-y-4">
                    <div className="flex flex-col gap-1">
                      {categories.map(cat => {
                        // Disable other cat-1 tags when video mode is active
                        const cat1 = categories.find(c => c.order === 1);
                        const videoTag = cat1 ? tags.find(t => t.categoryId === cat1.id && t.order === 1) : null;
                        const isVideoMode = !!(videoTag && formData.tagIds.includes(videoTag.id));
                        const isCat1 = cat.order === 1;

                        return (
                          <div key={cat.id} className="group relative flex flex-col md:flex-row md:items-center bg-white border border-slate-200 rounded-xl px-3 py-0.5 transition-all hover:border-blue-400 hover:shadow-md">
                            <div className="md:w-36 flex-shrink-0 flex items-center gap-2 mb-1 md:mb-0 border-b md:border-b-0 md:border-r border-slate-100 pb-1 md:pb-0 md:pr-3">
                              <span className={`w-5 h-5 ${cat.isRequired ? 'bg-red-600' : 'bg-blue-600'} text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-sm`}>
                                {cat.order}
                              </span>
                              <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-tight truncate">{cat.name}</h4>
                              {isVideoMode && isCat1 && <span className="text-[9px] text-purple-600 font-black bg-purple-50 px-1.5 py-0.5 rounded ml-auto md:ml-0">🎬 VÍDEO</span>}
                            </div>

                            <div className="flex-1 md:pl-4 flex flex-wrap gap-x-1.5 gap-y-1 py-0.5">
                              {tags.filter(t => t.categoryId === cat.id).map(tag => {
                                const isSelected = formData.tagIds.includes(tag.id);
                                // Disable non-video tags in cat-1 when video mode is active
                                const isVideoTag = videoTag && tag.id === videoTag.id;
                                const isDisabled = isVideoMode && isCat1 && !isVideoTag;
                                return (
                                  <button
                                    key={tag.id}
                                    type="button"
                                    disabled={isDisabled}
                                    onClick={() => !isDisabled && toggleModalTag(tag.id)}
                                    className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${isDisabled
                                      ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed opacity-50'
                                      : isSelected
                                        ? 'bg-blue-600 border-blue-600 text-white shadow-md scale-105'
                                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-white hover:border-blue-400 hover:text-blue-600'
                                      }`}
                                  >
                                    {isSelected && !isDisabled && <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg>}
                                    {tag.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div >

                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 sm:pt-8 border-t border-slate-100 bg-white mt-auto">
                  <div className="hidden sm:block bg-blue-50 px-5 py-3 rounded-2xl border border-blue-100">
                    <p className="text-[10px] font-bold text-blue-700 leading-tight uppercase">Salvamento com compactação inteligente ativa</p>
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button variant="outline" type="button" onClick={() => setIsModalOpen(false)} className="flex-1 sm:flex-none py-2 px-4 text-xs h-11 sm:h-10">Cancelar</Button>
                    <Button type="submit" disabled={saving || (!isVideoMode && !formData.url) || processingImage} className="flex-1 sm:flex-none px-6 sm:px-10 py-2 shadow-xl shadow-blue-500/20 text-xs font-black uppercase tracking-widest h-11 sm:h-10">
                      {saving || processingImage ? 'Processando...' : 'Finalizar'}
                    </Button>
                  </div>
                </div>
              </form>
            );
          })()}
        </Modal >
        <Modal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title={previewPhoto?.name || 'Vistas'} maxWidth="max-w-4xl">
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-full max-h-[60vh] bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center border border-slate-800 shadow-2xl">
              <img
                src={previewPhoto?.url}
                alt={previewPhoto?.name}
                className="max-w-full max-h-[60vh] object-contain cursor-zoom-out"
                onClick={() => setIsPreviewOpen(false)}
              />
              <button
                onClick={() => setIsPreviewOpen(false)}
                className="absolute top-4 right-4 p-1.5 bg-black/40 text-white rounded-full hover:bg-black/60 transition-all shadow-xl backdrop-blur-md border border-white/10"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-1 max-w-full overflow-hidden">
              {/* Tags removidas conforme solicitação */}
            </div>
            <div className="flex flex-col items-center gap-2 mt-1 w-full">
              {previewPhoto?.userName && (
                <div className="flex items-center gap-2 px-5 py-2.5 bg-blue-50 rounded-xl border border-blue-200 shadow-sm w-full justify-center">
                  <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Cadastrado por:</span>
                  <span className="text-[11px] font-black text-blue-800">{previewPhoto.userName}</span>
                </div>
              )}
              {previewPhoto?.storageLocation && (
                <div className="flex items-center gap-2 px-5 py-2.5 bg-green-50 rounded-xl border border-green-200 shadow-sm w-full justify-center mt-1">
                  <span className="text-[9px] font-black text-green-600 uppercase tracking-widest">Servidor/HD Original:</span>
                  <span className="text-[11px] font-black text-green-800">{previewPhoto.storageLocation}</span>
                </div>
              )}
              <div className="flex flex-col items-center gap-2.5 w-full">
                {typeof navigator !== 'undefined' && (
                  <Button
                    onClick={async () => {
                      if (!previewPhoto?.url) return;

                      // Attempt to share standard photo first
                      try {
                        const response = await fetch(previewPhoto.url);
                        const blob = await response.blob();
                        const file = new File([blob], previewPhoto.name ? `${previewPhoto.name}.jpg` : 'foto.jpg', { type: blob.type || 'image/jpeg' });

                        const shareData: any = {
                          title: previewPhoto.name || 'Foto da Galeria',
                          files: [file]
                        };

                        const defaultMsg = previewPhoto.name
                          ? `Conforme combinado, segue arquivo referente a "${previewPhoto.name}" para referência.`
                          : `Conforme combinado, segue arquivo para referência.`;

                        if (previewPhoto.videoUrl) {
                          shareData.text = `${defaultMsg}\nLink do vídeo: ${previewPhoto.videoUrl}`;
                        } else {
                          shareData.text = defaultMsg;
                        }

                        if (navigator.share) {
                          await navigator.share(shareData);
                        } else {
                          throw new Error("Web Share not supported");
                        }
                      } catch (error: any) {
                        console.error("Erro ao compartilhar imagem:", error);
                        // Fallback: compartilha URL via share se suportado ou WhatsApp Web
                        if (error.name !== 'AbortError') {
                          const fallbackMsg = previewPhoto.name
                            ? `Conforme combinado, segue arquivo referente a "${previewPhoto.name}" para referência.`
                            : `Conforme combinado, segue arquivo para referência.`;
                          if (navigator.share) {
                            try {
                              await navigator.share({
                                title: previewPhoto.name || 'Foto da Galeria',
                                text: previewPhoto.videoUrl
                                  ? `${fallbackMsg}\nLink do vídeo: ${previewPhoto.videoUrl}`
                                  : `${fallbackMsg}\nLink: ${previewPhoto.url}`
                              });
                            } catch (err) { }
                          } else {
                            const fallbackText = previewPhoto.videoUrl
                              ? `${fallbackMsg}\nLink do vídeo: ${previewPhoto.videoUrl}`
                              : `${fallbackMsg}\nLink: ${previewPhoto.url}`;
                            const text = encodeURIComponent(fallbackText);
                            window.open(`https://wa.me/?text=${text}`, '_blank');
                          }
                        }
                      }
                    }}
                    className="flex items-center justify-center w-full gap-2 py-3 px-6 text-[11px] font-black uppercase tracking-widest bg-[#25D366] hover:bg-[#128C7E] text-white shadow-md shadow-green-500/20 border-none transition-all"
                  >
                    <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      {/* Referência do ícone do WhatsApp */}
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.788-.703-1.322-1.573-1.477-1.871-.153-.299-.016-.461.133-.611.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    Compartilhar (WhatsApp)
                  </Button>
                )}
                <Button onClick={() => previewPhoto?.url && openFullscreen(previewPhoto.url)} className="flex items-center justify-center w-full gap-2 py-3 px-6 text-[11px] font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 border-none transition-all">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                  Ver em Tela Cheia
                </Button>
                {previewPhoto && canEditPhoto(previewPhoto) && (
                  <div className="flex w-full items-center gap-2.5">
                    <Button onClick={() => { setIsPreviewOpen(false); handleOpenModal(previewPhoto); }} className="flex-1 py-2.5 px-4 text-[10px] font-black uppercase tracking-widest shadow-md shadow-blue-500/20">
                      Editar
                    </Button>
                    <Button
                      variant="danger"
                      onClick={(e) => {
                        setIsPreviewOpen(false); // Close lightbox first
                        handleDelete(e, previewPhoto.id);
                      }}
                      className="flex-1 py-2.5 px-4 text-[10px] font-black uppercase tracking-widest shadow-md shadow-red-500/20 flex items-center justify-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Excluir
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Modal>

        {/* Fullscreen Photo Lightbox */}
        {fsUrl && (
          <div
            ref={fsOverlayRef}
            className="fixed inset-0 z-[9999] bg-black flex items-center justify-center overflow-hidden"
            onWheel={handleFsWheel}
            style={{ touchAction: 'none' }}
          >
            <img
              src={fsUrl}
              alt="Visualização em tela cheia"
              onLoad={handleFsImageLoad}
              draggable={false}
              style={fsNeedsRotation ? {
                // Counter-rotation: swap vw/vh so landscape image fills portrait screen
                width: '100vh',
                height: '100vw',
                maxWidth: 'none',
                maxHeight: 'none',
                objectFit: 'contain',
                transform: `rotate(90deg) scale(${fsZoom}) translate(${fsPan.x}px, ${fsPan.y}px)`,
                transformOrigin: 'center center',
                transition: 'none',
                userSelect: 'none',
                cursor: fsZoom > 1 ? 'grab' : 'default',
              } : {
                maxWidth: '100vw',
                maxHeight: '100vh',
                objectFit: 'contain',
                transform: `scale(${fsZoom}) translate(${fsPan.x}px, ${fsPan.y}px)`,
                transformOrigin: 'center center',
                transition: 'none',
                userSelect: 'none',
                cursor: fsZoom > 1 ? 'grab' : 'default',
              }}
            />
            {/* Close button */}
            <button
              onClick={closeFullscreen}
              className="absolute top-4 right-4 z-10 w-12 h-12 bg-black/70 text-white rounded-full flex items-center justify-center hover:bg-black/90 active:scale-95 transition-all border border-white/20 backdrop-blur-sm shadow-lg"
              title="Fechar"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {/* Zoom indicator + reset */}
            {fsZoom > 1 && (
              <button
                onClick={() => { setFsZoom(1); setFsPan({ x: 0, y: 0 }); }}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 px-5 py-2 bg-black/70 text-white text-xs font-bold rounded-full border border-white/20 backdrop-blur-sm hover:bg-black/90 transition-all"
              >
                ✕ {Math.round(fsZoom * 100)}%
              </button>
            )}
          </div>
        )}

        {/* Export Action Bar */}
        {
          selectedExportIds.size > 0 && (
            <div className="hidden md:block fixed bottom-2 md:bottom-6 left-1/2 -translate-x-1/2 z-50 animate-bounce-in w-[95%] md:w-auto max-w-lg">
              <div className="bg-slate-900 border border-slate-700 text-white !px-2 md:px-6 !py-2 md:py-4 rounded-xl shadow-2xl flex items-center justify-between gap-3 backdrop-blur-xl">
                <div className="flex flex-col">
                  <span className="text-xs md:text-sm font-bold whitespace-nowrap">{effectiveSelectionCount} {effectiveSelectionCount === 1 ? 'Foto' : 'Fotos'}</span>
                  <span className="text-[9px] md:text-[10px] text-slate-400 truncate max-w-[120px] md:max-w-none">
                    {selectedExportIds.size !== effectiveSelectionCount
                      ? `(${selectedExportIds.size} selec.)`
                      : 'Pronto p/ PDF'}
                  </span>
                </div>

                <div className="h-6 w-px bg-slate-700 hidden md:block"></div>

                <div className="flex gap-2 overflow-hidden">
                  <Button variant="outline" onClick={() => setSelectedExportIds(new Set())} className="text-slate-300 border-slate-600 hover:bg-slate-800 p-1.5 md:py-1.5 md:px-4 text-[10px] md:text-xs h-8 md:h-9" title="Cancelar seleção">
                    {/* Icon for mobile, Text for desktop */}
                    <span className="hidden md:inline">Cancelar</span>
                    <svg className="w-4 h-4 md:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </Button>

                  <Button
                    onClick={handleExportPDF}
                    className={`py-1.5 px-4 md:px-6 text-[10px] md:text-xs h-9 md:h-10 shadow-lg flex items-center gap-1.5 md:gap-2 transition-all whitespace-nowrap ${effectiveSelectionCount > pdfLimit
                      ? 'bg-red-600 hover:bg-red-700 shadow-red-500/20'
                      : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'
                      }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="sm:inline">Gerar PDF</span>
                  </Button>
                </div>
              </div>
            </div>
          )
        }
        {/* Removed Action Bar and Share Modal for Mobile/Desktop */}

        {/* PDF Progress Modal */}
        <Modal
          isOpen={isExporting}
          onClose={() => { }} // User should not close during generation
          title="Exportando Relatório"
          maxWidth="max-w-sm"
        >
          <div className="flex flex-col items-center justify-center py-6 text-center space-y-6">
            <div className="w-20 h-20 rounded-3xl bg-blue-50 flex items-center justify-center mb-2 animate-pulse shadow-inner border border-blue-100">
              <LoadingSpinner />
            </div>

            <div className="space-y-3 w-full px-4">
              <h3 className="text-xl font-black text-slate-800 tracking-tight">Gerando PDF</h3>
              <p className="text-sm font-bold text-blue-600 bg-blue-50 py-2 px-4 rounded-xl border border-blue-100 shadow-sm">{exportProgress || 'Iniciando o processo...'}</p>

              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden mt-6 shadow-inner relative">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 background-animate w-[200%] h-full"></div>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-6 max-w-[250px] leading-relaxed">
              Por favor, não feche o aplicativo. O processo pode levar alguns minutos dependendo da quantidade de fotos.
            </p>
          </div>
        </Modal>


        {/* PDF Actions Modal */}
        <Modal
          isOpen={pdfActionModal.isOpen}
          onClose={() => setPdfActionModal(prev => ({ ...prev, isOpen: false }))}
          title="PDF Gerado com Sucesso!"
          maxWidth="max-w-sm"
        >
          <div className="flex flex-col items-center gap-4 py-4">
            {/* Icone de sucesso */}
            <div className="w-16 h-16 rounded-full bg-green-50 border border-green-200 flex items-center justify-center shadow-inner">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-xs font-bold text-slate-500 text-center">O que deseja fazer com o PDF?</p>

            <div className="flex flex-col gap-2 w-full mt-1">
              {/* Visualizar */}
              <button
                onClick={() => {
                  if (!pdfActionModal.blob) return;
                  const url = URL.createObjectURL(pdfActionModal.blob);
                  window.open(url, '_blank', 'noopener');
                  // revoke after a delay to allow the tab to open
                  setTimeout(() => URL.revokeObjectURL(url), 60000);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-black uppercase tracking-widest transition-all active:scale-95 shadow-md shadow-blue-500/20"
              >
                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Visualizar PDF
              </button>

              {/* Baixar */}
              <button
                onClick={() => {
                  if (!pdfActionModal.blob) return;
                  const url = URL.createObjectURL(pdfActionModal.blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = pdfActionModal.fileName;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 5000);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-sm font-black uppercase tracking-widest transition-all active:scale-95 shadow-md"
              >
                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Baixar PDF
              </button>

              {/* Compartilhar (só aparece se o browser suporta Web Share API) */}
              {typeof navigator.share === 'function' && (
                <button
                  onClick={async () => {
                    if (!pdfActionModal.blob) return;
                    const pdfFile = new File([pdfActionModal.blob], pdfActionModal.fileName, { type: 'application/pdf' });
                    const txtToShare = 'Conforme combinado, segue arquivo para referência.';

                    try {
                      await navigator.share({
                        title: 'Galeria de Fotos',
                        text: txtToShare,
                        files: [pdfFile]
                      });
                    } catch (e) {
                      // User cancelled share or error
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-black uppercase tracking-widest transition-all active:scale-95 shadow-md shadow-green-500/20"
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Compartilhar
                </button>
              )}
            </div>

            <button
              onClick={() => setPdfActionModal(prev => ({ ...prev, isOpen: false }))}
              className="text-xs text-slate-400 hover:text-slate-600 font-bold mt-1 transition-colors"
            >
              Fechar
            </button>
          </div>
        </Modal>

        <AlertModal {...alertState} onClose={() => setAlertState(prev => ({ ...prev, isOpen: false }))} />

      </>
    </Layout >
  );
};

export default Photos;
