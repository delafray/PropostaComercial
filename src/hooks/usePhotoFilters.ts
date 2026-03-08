// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
import { useState, useMemo, useRef } from 'react';
import { Tag, TagCategory } from '../../types';
import { seededShuffle } from '../utils/mathUtils';

interface UsePhotoFiltersProps {
    photoIndex: Array<{ id: string; name: string; tagIds: string[]; userId: string; videoUrl?: string; createdAt: string }>;
    tags: Tag[];
    categories: TagCategory[];
}

export const usePhotoFilters = ({ photoIndex, tags, categories }: UsePhotoFiltersProps) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
    const [onlyMine, setOnlyMine] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState<string>('all');
    const [sortByDate, setSortByDate] = useState(false);

    // Seed for deterministic shuffling (generated once per session/mount)
    const shuffleSeed = useRef(Math.floor(Math.random() * 2147483647));

    // --- Memoized Shuffled Index to Prevent Re-Shuffling on Every Render ---
    const shuffledPhotoIndex = useMemo(() => {
        return seededShuffle(photoIndex, shuffleSeed.current).filter(p => p && typeof p === 'object' && 'id' in p);
    }, [photoIndex]);

    // --- FILTERING LOGIC ---
    const filteredResult = useMemo(() => {
        let currentIds = [...shuffledPhotoIndex];

        // 1. Filtro por texto
        if (searchTerm) {
            const lowerSearch = searchTerm.toLowerCase();
            currentIds = currentIds.filter(p => p.name?.toLowerCase()?.includes(lowerSearch) ?? false);
        }

        // 1.2 Filtro por usuário selecionado
        if (selectedUserId !== 'all') {
            currentIds = currentIds.filter(p => p.userId === selectedUserId);
        }

        // 2. Filtro Hierárquico
        categories.forEach((cat) => {
            if (!cat || !cat.id) return;
            const catTags = tags.filter(t => t && t.categoryId === cat.id);
            const selectedInCat = selectedTagIds.filter(id => catTags.some(t => t.id === id));
            if (selectedInCat.length > 0) {
                currentIds = currentIds.filter(p =>
                    Array.isArray(p.tagIds) && selectedInCat.some(tagId => p.tagIds.includes(tagId))
                );
            }
        });

        // 3. Sorting
        if (sortByDate) {
            currentIds = [...currentIds].sort((a, b) => {
                // Safe access in case createdAt is missing/invalid
                const dateA = new Date(a?.createdAt || 0).getTime();
                const dateB = new Date(b?.createdAt || 0).getTime();
                return dateB - dateA;
            });
        }

        // Calcular tags disponíveis (Cascata)
        const availableTagsByLevel: { [order: number]: Set<string> } = {};
        let tempIds = [...shuffledPhotoIndex];
        if (searchTerm) {
            const lowerSearch = searchTerm.toLowerCase();
            tempIds = tempIds.filter(p => p.name?.toLowerCase().includes(lowerSearch));
        }
        if (selectedUserId !== 'all') tempIds = tempIds.filter(p => p.userId === selectedUserId);

        categories.forEach((cat) => {
            if (!cat) return;
            const currentAvailableTags = new Set<string>();
            tempIds.forEach(p => {
                if (Array.isArray(p.tagIds)) {
                    p.tagIds.forEach(tid => currentAvailableTags.add(tid));
                }
            });
            availableTagsByLevel[cat.order] = currentAvailableTags;

            const catTags = tags.filter(t => t && t.categoryId === cat.id);
            const selectedInCat = selectedTagIds.filter(id => catTags.some(t => t.id === id));
            if (selectedInCat.length > 0) {
                tempIds = tempIds.filter(p => Array.isArray(p.tagIds) && selectedInCat.some(tagId => p.tagIds.includes(tagId)));
            }
        });

        // Calculate Lineage Tags (all tags present in current matching photos)
        const activeLineageTags = new Set<string>();
        if (selectedTagIds.length > 0) {
            currentIds.forEach(p => {
                if (Array.isArray(p.tagIds)) {
                    p.tagIds.forEach(tid => activeLineageTags.add(tid));
                }
            });
        }

        return {
            ids: currentIds.map(p => p.id),
            availableTagsByLevel,
            activeLineageTags
        };
    }, [shuffledPhotoIndex, categories, tags, selectedTagIds, searchTerm, selectedUserId, sortByDate]);

    const toggleFilterTag = (tagId: string) => {
        setSelectedTagIds(prev =>
            prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
        );
    };

    const clearAllFilters = (isAdminOrProjetista: boolean) => {
        setSelectedTagIds([]);
        setSearchTerm('');
        if (isAdminOrProjetista) {
            setOnlyMine(false);
            setSelectedUserId('all');
        }
    };

    return {
        searchTerm, setSearchTerm,
        selectedTagIds, setSelectedTagIds,
        onlyMine, setOnlyMine,
        selectedUserId, setSelectedUserId,
        sortByDate, setSortByDate,
        filteredResult,
        toggleFilterTag,
        clearAllFilters
    };
};
