import axios from 'axios'
import type {
  AuthResponse, UserSearchDto, FriendDto, FriendRequestDto,
  MessageDto, GroupDto, GroupMessageDto
} from '../types'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('qc_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (username: string, password: string, displayName?: string) =>
    api.post<AuthResponse>('/auth/register', { username, password, displayName }).then(r => r.data),
  login: (username: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { username, password }).then(r => r.data),
  deleteAccount: () =>
    api.delete('/users/me').then(r => r.data),
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const usersApi = {
  search:     (q?: string) =>
    api.get<UserSearchDto[]>('/users', { params: { search: q } }).then(r => r.data),
  getFriends: () =>
    api.get<FriendDto[]>('/users/friends').then(r => r.data),
  getPublicKey: (userId: number) =>
    api.get<{ userId: number; kyberPublicKey: string; ecdhPublicKey: string }>(`/users/${userId}/publickey`).then(r => r.data),
}

// ── Friends ───────────────────────────────────────────────────────────────────
export const friendsApi = {
  getRequests: () =>
    api.get<FriendRequestDto[]>('/friends/requests').then(r => r.data),
  sendRequest: (receiverId: number) =>
    api.post('/friends/request', { receiverId }).then(r => r.data),
  respond: (requestId: number, action: 'accept' | 'reject') =>
    api.post<{ friendshipId?: number; kemCiphertext?: string; status?: string }>(
      '/friends/respond', { requestId, action }
    ).then(r => r.data),
}

// ── Messages ──────────────────────────────────────────────────────────────────
export const messagesApi = {
  getMessages: (friendId: number, page = 1) =>
    api.get<MessageDto[]>(`/messages/${friendId}`, { params: { page } }).then(r => r.data),
  sendMessage: (dto: {
    receiverId: number; encryptedContent: string; iv: string; tag: string;
    messageType?: string; fileName?: string; fileSize?: number;
  }) => api.post<MessageDto>('/messages', dto).then(r => r.data),
  sendFile: (formData: FormData) =>
    api.post<MessageDto>('/messages/file', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(r => r.data),
}

// ── Groups ────────────────────────────────────────────────────────────────────
export const groupsApi = {
  getMyGroups: () =>
    api.get<GroupDto[]>('/groups').then(r => r.data),
  createGroup: (name: string, description: string | undefined, memberIds: number[]) =>
    api.post<GroupDto>('/groups', { name, description, memberIds }).then(r => r.data),
  addMembers: (groupId: number, memberIds: number[]) =>
    api.post<GroupDto>(`/groups/${groupId}/members`, { memberIds }).then(r => r.data),
  getMessages: (groupId: number, page = 1) =>
    api.get<GroupMessageDto[]>(`/groups/${groupId}/messages`, { params: { page } }).then(r => r.data),
  sendMessage: (groupId: number, dto: {
    groupId: number; encryptedContent: string; iv: string; tag: string;
    messageType?: string; fileName?: string; fileSize?: number;
  }) => api.post<GroupMessageDto>(`/groups/${groupId}/messages`, dto).then(r => r.data),
  sendFile: (groupId: number, formData: FormData) =>
    api.post<GroupMessageDto>(`/groups/${groupId}/file`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(r => r.data),
  getAllGroups: () =>
    api.get<GroupDto[]>('/groups/all').then(r => r.data),
  interceptMessages: (groupId: number) =>
    api.get(`/groups/${groupId}/intercept`).then(r => r.data),
  mitmDemo: (groupId: number) =>
    api.get(`/groups/${groupId}/mitm-demo`).then(r => r.data),
  removeMember: (groupId: number, userId: number) =>
    api.delete(`/groups/${groupId}/members/${userId}`).then(r => r.data),
  transferAdmin: (groupId: number, newAdminId: number) =>
    api.post<GroupDto>(`/groups/${groupId}/transfer-admin/${newAdminId}`).then(r => r.data),
  leaveGroup: (groupId: number, newAdminId?: number) =>
    api.delete(`/groups/${groupId}/leave`, { params: { newAdminId } }).then(r => r.data),
  deleteGroup: (groupId: number) =>
    api.delete(`/groups/${groupId}`).then(r => r.data),
}

// ── Crypto ────────────────────────────────────────────────────────────────────
export const cryptoApi = {
  mitmDemo: (plaintextMessage: string) =>
    api.post('/crypto/mitm-demo', { plaintextMessage }).then(r => r.data),
  myKeys: () =>
    api.get('/crypto/my-keys').then(r => r.data),
  decapsulate: (kemCiphertext: string) =>
    api.post<{ sharedSecretB64: string }>('/crypto/decapsulate', { kemCiphertext }).then(r => r.data),
  trace: (title: string, values: Record<string, string>) =>
    api.post('/crypto/trace', { title, values }).catch(() => undefined),
}

export default api
