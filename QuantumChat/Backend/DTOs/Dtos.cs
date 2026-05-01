namespace QuantumChat.DTOs;

public record RegisterRequest(string Username, string Password, string? DisplayName);
public record LoginRequest(string Username, string Password);
public record AuthResponse(
    string Token, int UserId, string Username, string DisplayName, string AvatarColor,
    string KyberPublicKey, string EcdhPublicKey,
    string KyberPrivateKeyEncrypted, string EcdhPrivateKeyEncrypted
);

public record UserDto(int Id, string Username, string DisplayName, string AvatarColor, bool IsOnline, DateTime LastSeen);
public record UserSearchDto(int Id, string Username, string DisplayName, string AvatarColor, bool IsOnline, DateTime LastSeen, string RelationStatus);
public record UserPublicKeyDto(int UserId, string KyberPublicKey, string EcdhPublicKey);

public record SendFriendRequestDto(int ReceiverId);
public record RespondFriendRequestDto(int RequestId, string Action);
public record FriendRequestDto(int Id, UserDto Sender, UserDto Receiver, string Status, DateTime CreatedAt);
public record FriendDto(int FriendshipId, UserDto Friend, string KemCiphertext);

public record SendMessageDto(
    int ReceiverId, string EncryptedContent, string IV, string Tag,
    string MessageType = "text", string? FileName = null, long? FileSize = null);

// ReceiverId added so SignalR MessageSent handler can find the right dmKey
public record MessageDto(
    int Id, int SenderId, int ReceiverId,
    string SenderUsername, string SenderDisplayName, string SenderAvatarColor,
    string EncryptedContent, string IV, string Tag,
    string MessageType, string? FileName, long? FileSize, DateTime SentAt, bool IsRead);

public record CreateGroupDto(string Name, string? Description, List<int> MemberIds);
public record AddGroupMembersDto(List<int> MemberIds);
public record GroupMemberDto(int UserId, string Username, string DisplayName, string AvatarColor, string Role, string KemCiphertext);
public record GroupDto(int Id, string Name, string? Description, string AvatarColor, int CreatedBy, DateTime CreatedAt, List<GroupMemberDto> Members);

public record SendGroupMessageDto(
    int GroupId, string EncryptedContent, string IV, string Tag,
    string MessageType = "text", string? FileName = null, long? FileSize = null);

public record GroupMessageDto(
    int Id, int GroupId, int SenderId,
    string SenderUsername, string SenderDisplayName, string SenderAvatarColor,
    string EncryptedContent, string IV, string Tag,
    string MessageType, string? FileName, long? FileSize, DateTime SentAt);

public record MitmDemoRequest(string PlaintextMessage);
public record CryptoTraceRequest(string Title, Dictionary<string, string> Values);
