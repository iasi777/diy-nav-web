export interface Website {
  id: string
  name: string
  url: string
  description?: string
  categoryId: string
  tagIds: string[]
  favicon?: string
  visitCount: number
  lastVisited?: Date
  isFavorite?: boolean
  isOnline: boolean
  createdAt: Date
  updatedAt: Date
  order?: number
  favoriteOrder?: number
  version: number
}

export interface Category {
  id: string
  name: string
  description?: string
  icon?: string
  order: number
  websiteCount: number
  createdAt: Date
  updatedAt: Date
  version: number
}

export interface Tag {
  id: string
  name: string
  color: string
  order: number
  usageCount: number
  createdAt: Date
  updatedAt: Date
  version: number
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'auto'
  defaultHome?: 'home' | 'all'
}

export interface BackupData {
  websites: Partial<Website>[]
  categories: Partial<Category>[]
  tags: Partial<Tag>[]
  settings?: Partial<UserSettings>
}

export interface BackupMetadata {
  version: string
  createdAt: string
  appVersion?: string
  platform?: string
}

export interface BackupPayload {
  meta: BackupMetadata
  data: BackupData
}
