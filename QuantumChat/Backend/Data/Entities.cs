using System.ComponentModel.DataAnnotations;

namespace QuantumChat.Data;

public class User
{
    public int Id { get; set; }
    [Required, MaxLength(50)] public string Username { get; set; } = "";
    [Required] public string PasswordHash { get; set; } = "";
    [MaxLength(100)] public string DisplayName { get; set; } = "";
    public string AvatarColor { get; set; } = "#6366f1";
    public bool IsOnline { get; set; } = false;
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Stores both ML-KEM-768 and ECDH P-256 key material per user.
/// Private keys are stored server-encrypted (KEK) for decapsulation,
/// and password-encrypted for client-side recovery.
/// </summary>
public class UserKeyStore
{
    public int Id { get; set; }
    public int UserId { get; set; }

    // ML-KEM-768 keys
    public string KyberPublicKey { get; set; } = "";
    public string KyberPrivateKeyEncrypted { get; set; } = "";        // password-encrypted
    public string KyberPrivateKeyServerEncrypted { get; set; } = "";  // KEK-encrypted

    // ECDH P-256 keys
    public string EcdhPublicKey { get; set; } = "";                   // SubjectPublicKeyInfo, Base64
    public string EcdhPrivateKeyEncrypted { get; set; } = "";         // password-encrypted
    public string EcdhPrivateKeyServerEncrypted { get; set; } = "";   // KEK-encrypted

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class FriendRequest
{
    public int Id { get; set; }
    public int SenderId { get; set; }
    public int ReceiverId { get; set; }
    public string Status { get; set; } = "pending";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public User? Sender { get; set; }
    public User? Receiver { get; set; }
}

/// <summary>
/// Wire format for KemCiphertextForUserN:
///   "kyberKemB64:ecdhEphemeralPubB64|wrappedKeyB64"
/// wrappedKey = friendshipKey XOR HKDF(combinedSecret, info="FriendKeyWrap")
/// </summary>
public class Friendship
{
    public int Id { get; set; }
    public int User1Id { get; set; }
    public int User2Id { get; set; }
    public string KemCiphertextForUser1 { get; set; } = "";
    public string KemCiphertextForUser2 { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public User? User1 { get; set; }
    public User? User2 { get; set; }
}

public class Message
{
    public int Id { get; set; }
    public int SenderId { get; set; }
    public int ReceiverId { get; set; }
    public string EncryptedContent { get; set; } = "";
    public string IV { get; set; } = "";
    public string Tag { get; set; } = "";
    public string MessageType { get; set; } = "text";
    public string? FileName { get; set; }
    public long? FileSize { get; set; }
    public string? FilePath { get; set; }
    public bool IsRead { get; set; } = false;
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    public User? Sender { get; set; }
}

public class Group
{
    public int Id { get; set; }
    [Required, MaxLength(100)] public string Name { get; set; } = "";
    [MaxLength(300)] public string? Description { get; set; }
    public int CreatedBy { get; set; }
    public string AvatarColor { get; set; } = "#10b981";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<GroupMember> Members { get; set; } = [];
}

/// <summary>
/// Wire format for KemCiphertextForMember:
///   "kyberKemB64:ecdhEphemeralPubB64|wrappedKeyB64"
/// </summary>
public class GroupMember
{
    public int Id { get; set; }
    public int GroupId { get; set; }
    public int UserId { get; set; }
    public string Role { get; set; } = "member";
    public string KemCiphertextForMember { get; set; } = "";
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    public Group? Group { get; set; }
    public User? User { get; set; }
}

public class GroupMessage
{
    public int Id { get; set; }
    public int GroupId { get; set; }
    public int SenderId { get; set; }
    public string EncryptedContent { get; set; } = "";
    public string IV { get; set; } = "";
    public string Tag { get; set; } = "";
    public string MessageType { get; set; } = "text";
    public string? FileName { get; set; }
    public long? FileSize { get; set; }
    public string? FilePath { get; set; }
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    public User? Sender { get; set; }
    public Group? Group { get; set; }
}
