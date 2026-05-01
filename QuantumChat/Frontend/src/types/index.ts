export interface AuthResponse {
  token: string; userId: number; username: string;
  displayName: string; avatarColor: string;
  kyberPublicKey: string; ecdhPublicKey: string;
  kyberPrivateKeyEncrypted: string; ecdhPrivateKeyEncrypted: string;
}
export interface CurrentUser {
  token: string; userId: number; username: string;
  displayName: string; avatarColor: string;
  kyberPublicKey: string; ecdhPublicKey: string;
  kyberPrivateKey: string; ecdhPrivateKey: string;
}
export interface UserDto {
  id: number; username: string; displayName: string;
  avatarColor: string; isOnline: boolean; lastSeen: string;
}
export interface UserSearchDto extends UserDto {
  relationStatus: 'none' | 'friend' | 'request_sent' | 'request_received';
}
export interface FriendDto {
  friendshipId: number; friend: UserDto; kemCiphertext: string;
}
export interface FriendRequestDto {
  id: number; sender: UserDto; receiver: UserDto;
  status: 'pending' | 'accepted' | 'rejected'; createdAt: string;
}
export interface MessageDto {
  id: number;
  senderId: number;
  receiverId: number;          // ← added
  senderUsername: string;
  senderDisplayName: string;
  senderAvatarColor: string;
  encryptedContent: string; iv: string; tag: string;
  messageType: 'text' | 'file' | 'image';
  fileName?: string; fileSize?: number;
  sentAt: string; isRead: boolean; plaintext?: string;
}
export interface GroupMemberDto {
  userId: number; username: string; displayName: string;
  avatarColor: string; role: 'admin' | 'member'; kemCiphertext: string;
}
export interface GroupDto {
  id: number; name: string; description?: string;
  avatarColor: string; createdBy: number; createdAt: string;
  members: GroupMemberDto[];
}
export interface GroupMessageDto {
  id: number; groupId: number; senderId: number;
  senderUsername: string; senderDisplayName: string; senderAvatarColor: string;
  encryptedContent: string; iv: string; tag: string;
  messageType: 'text' | 'file' | 'image';
  fileName?: string; fileSize?: number;
  sentAt: string; plaintext?: string;
}
export type ChatTarget =
  | { type: 'direct'; friend: FriendDto }
  | { type: 'group';  group: GroupDto };
