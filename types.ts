// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
import type { User } from './services/authService';
export type { User };

export interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  register: (name: string, email: string, password: string, isAdmin: boolean) => Promise<void>;
  isLoading: boolean;
}

export interface TagCategory {
  id: string;
  userId: string;
  name: string;
  order: number;
  isRequired: boolean;
  peerCategoryIds?: string[];
  createdAt: string;
}

export interface Tag {
  id: string;
  userId: string;
  name: string;
  categoryId: string; // Referência à categoria pai
  order: number; // Novo campo de ordenação manual
  createdAt: string;
}

export interface Photo {
  id: string;
  userId: string;
  name: string;
  url: string; // Base64 ou URL da imagem/capa
  tagIds: string[];
  localPath?: string;
  storageLocation?: string; // Novo campo: Servidor ou HD original
  thumbnailUrl?: string;
  videoUrl?: string; // Link original do Instagram
  createdAt: string;
  userName?: string;
}

export interface GalleryService {
  // Tag Categories
  getTagCategories: (userId: string) => Promise<TagCategory[]>;
  createTagCategory: (userId: string, name: string, order: number, isRequired?: boolean, peerCategoryIds?: string[]) => Promise<TagCategory>;
  updateTagCategory: (id: string, data: Partial<TagCategory>) => Promise<TagCategory>;
  deleteTagCategory: (id: string) => Promise<void>;

  // Tags
  getTags: (userId: string) => Promise<Tag[]>;
  createTag: (userId: string, name: string, categoryId: string, order?: number) => Promise<Tag>;
  updateTag: (id: string, data: Partial<Tag>) => Promise<Tag>;
  deleteTag: (id: string) => Promise<void>;

  // Photos
  getPhotoIndex: (userId: string, onlyMine?: boolean) => Promise<Array<{ id: string; name: string; tagIds: string[]; userId: string; userName?: string; createdAt: string }>>;
  getPhotosByIds: (ids: string[]) => Promise<Photo[]>;
  getPhotos: (userId: string) => Promise<Photo[]>;
  uploadPhotoFile: (userId: string, file: File) => Promise<string>;
  createPhoto: (userId: string, data: Omit<Photo, 'id' | 'createdAt' | 'userId'>) => Promise<Photo>;
  updatePhoto: (id: string, data: Partial<Photo>) => Promise<Photo>;
  deletePhoto: (id: string) => Promise<void>;

  // Users
  getUsersWithPhotos: () => Promise<Array<{ id: string; name: string }>>;
  getUsers: () => Promise<Array<{ id: string; name: string }>>;

  // System Config
  getSystemConfig: (key: string) => Promise<string | null>;
  updateSystemConfig: (userId: string, key: string, value: string) => Promise<void>;
}
