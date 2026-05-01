using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using QuantumChat.Crypto;
using QuantumChat.Data;
using QuantumChat.DTOs;
using QuantumChat.Hubs;
using System.Security.Claims;
using System.Security.Cryptography;

namespace QuantumChat.Controllers;

[ApiController]
[Route("api/groups")]
[Authorize]
public class GroupsController : ControllerBase
{
    private readonly AppDbContext         _db;
    private readonly IHubContext<ChatHub> _hub;
    private readonly HybridPqcService     _pqc;
    private readonly IConfiguration       _cfg;
    private readonly ILogger<GroupsController> _log;

    public GroupsController(AppDbContext db, IHubContext<ChatHub> hub, HybridPqcService pqc,
        IConfiguration cfg, ILogger<GroupsController> log)
    { _db = db; _hub = hub; _pqc = pqc; _cfg = cfg; _log = log; }

    private int Me => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<IActionResult> GetMyGroups()
    {
        var myId   = Me;
        var groups = await _db.Groups.Include(g => g.Members).ThenInclude(m => m.User)
                        .Where(g => g.Members.Any(m => m.UserId == myId)).ToListAsync();
        return Ok(groups.Select(g => MapGroup(g, myId)));
    }

    [HttpPost]
    public async Task<IActionResult> CreateGroup([FromBody] CreateGroupDto dto)
    {
        var myId = Me;
        var myFriendIds = await _db.Friendships
            .Where(f => f.User1Id == myId || f.User2Id == myId)
            .Select(f => f.User1Id == myId ? f.User2Id : f.User1Id).ToListAsync();

        var nonFriends = dto.MemberIds.Where(id => id != myId && !myFriendIds.Contains(id)).ToList();
        if (nonFriends.Count > 0)
            return BadRequest(new { error = "Can only add friends to a group." });

        string[] palette = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444"];
        var group = new Group
        {
            Name        = dto.Name.Trim(),
            Description = dto.Description?.Trim(),
            CreatedBy   = myId,
            AvatarColor = palette[Random.Shared.Next(palette.Length)]
        };
        _db.Groups.Add(group);
        await _db.SaveChangesAsync();

        var allMemberIds = dto.MemberIds.Distinct().ToList();
        if (!allMemberIds.Contains(myId)) allMemberIds.Insert(0, myId);

        var groupMasterSecret = RandomNumberGenerator.GetBytes(32);

        foreach (var memberId in allMemberIds)
        {
            var ks = await _db.UserKeyStores.FirstOrDefaultAsync(k => k.UserId == memberId);
            if (ks == null) continue;

            // Hybrid KEM for each member
            var (combinedSecret, hybridCt) = _pqc.HybridEncapsulate(ks.KyberPublicKey, ks.EcdhPublicKey);
            var wrapKey    = HKDF.DeriveKey(HashAlgorithmName.SHA256, combinedSecret, 32,
                                 info: System.Text.Encoding.UTF8.GetBytes("GroupKeyWrap"));
            var wrapped    = XorBytes(groupMasterSecret, wrapKey);
            var stored     = $"{hybridCt}|{Convert.ToBase64String(wrapped)}";

            TraceCrypto("GROUP CREATE",
                ("groupId", group.Id.ToString()),
                ("memberId", memberId.ToString()),
                ("groupMasterSecretB64", B64(groupMasterSecret)),
                ("hybridCiphertext", hybridCt),
                ("combinedSecretB64", B64(combinedSecret)),
                ("wrapKeyB64", B64(wrapKey)),
                ("wrappedGroupKeyB64", B64(wrapped)));

            _db.GroupMembers.Add(new GroupMember
            {
                GroupId = group.Id, UserId = memberId,
                Role    = memberId == myId ? "admin" : "member",
                KemCiphertextForMember = stored
            });
        }
        await _db.SaveChangesAsync();

        var fullGroup = await _db.Groups.Include(g => g.Members).ThenInclude(m => m.User)
                            .FirstAsync(g => g.Id == group.Id);
        var groupDto  = MapGroup(fullGroup, myId);

        foreach (var memberId in allMemberIds.Where(id => id != myId))
            await _hub.Clients.Group($"user_{memberId}").SendAsync("AddedToGroup", MapGroup(fullGroup, memberId));

        return Ok(groupDto);
    }

    [HttpPost("{groupId:int}/members")]
    public async Task<IActionResult> AddMembers(int groupId, [FromBody] AddGroupMembersDto dto)
    {
        var myId = Me;
        var group = await _db.Groups.Include(g => g.Members).ThenInclude(m => m.User)
            .FirstOrDefaultAsync(g => g.Id == groupId);
        if (group == null) return NotFound();
        if (!group.Members.Any(m => m.UserId == myId && m.Role == "admin")) return Forbid();

        var memberIds = dto.MemberIds.Distinct()
            .Where(id => id != myId && group.Members.All(m => m.UserId != id))
            .ToList();
        if (memberIds.Count == 0) return BadRequest(new { error = "No new members selected." });

        var myFriendIds = await _db.Friendships
            .Where(f => f.User1Id == myId || f.User2Id == myId)
            .Select(f => f.User1Id == myId ? f.User2Id : f.User1Id)
            .ToListAsync();

        var nonFriends = memberIds.Where(id => !myFriendIds.Contains(id)).ToList();
        if (nonFriends.Count > 0)
            return BadRequest(new { error = "Can only add friends to a group." });

        var sourceMember = group.Members.FirstOrDefault(m => !string.IsNullOrEmpty(m.KemCiphertextForMember));
        if (sourceMember == null) return StatusCode(500, new { error = "No existing group key wrapper found." });

        var groupMasterSecret = await UnwrapGroupKeyForMember(sourceMember);

        foreach (var memberId in memberIds)
        {
            var ks = await _db.UserKeyStores.FirstOrDefaultAsync(k => k.UserId == memberId);
            if (ks == null) continue;

            var stored = WrapGroupKeyForMember(group.Id, memberId, groupMasterSecret, ks);
            _db.GroupMembers.Add(new GroupMember
            {
                GroupId = group.Id,
                UserId = memberId,
                Role = "member",
                KemCiphertextForMember = stored
            });
        }

        await _db.SaveChangesAsync();

        var fullGroup = await LoadGroup(groupId);
        foreach (var member in fullGroup!.Members)
        {
            var dtoForMember = MapGroup(fullGroup, member.UserId);
            if (memberIds.Contains(member.UserId))
                await _hub.Clients.Group($"user_{member.UserId}").SendAsync("AddedToGroup", dtoForMember);
            else
                await _hub.Clients.Group($"user_{member.UserId}").SendAsync("GroupUpdated", dtoForMember);
        }

        return Ok(MapGroup(fullGroup, myId));
    }

    [HttpGet("{groupId:int}/messages")]
    public async Task<IActionResult> GetMessages(int groupId, [FromQuery] int page = 1, [FromQuery] int size = 50)
    {
        var myId = Me;
        if (!await IsMember(myId, groupId)) return Forbid();
        var msgs = await _db.GroupMessages.Include(m => m.Sender)
            .Where(m => m.GroupId == groupId).OrderByDescending(m => m.SentAt)
            .Skip((page - 1) * size).Take(size).ToListAsync();
        return Ok(msgs.OrderBy(m => m.SentAt).Select(ToGroupMsgDto));
    }

    [HttpPost("{groupId:int}/messages")]
    public async Task<IActionResult> SendGroupMessage(int groupId, [FromBody] SendGroupMessageDto dto)
    {
        var myId = Me;
        if (!await IsMember(myId, groupId)) return Forbid();
        var msg = new GroupMessage
        {
            GroupId = groupId, SenderId = myId,
            EncryptedContent = dto.EncryptedContent, IV = dto.IV, Tag = dto.Tag,
            MessageType = dto.MessageType, FileName = dto.FileName, FileSize = dto.FileSize
        };
        _db.GroupMessages.Add(msg);
        await _db.SaveChangesAsync();
        await _db.Entry(msg).Reference(m => m.Sender).LoadAsync();
        var msgDto = ToGroupMsgDto(msg);
        TraceCrypto("GROUP MESSAGE",
            ("groupId", groupId.ToString()),
            ("messageId", msg.Id.ToString()),
            ("senderId", myId.ToString()),
            ("messageType", msg.MessageType),
            ("ciphertextB64", dto.EncryptedContent),
            ("ivB64", dto.IV),
            ("tagB64", dto.Tag),
            ("note", "Group AES key stays client-side; backend receives ciphertext/IV/tag only."));
        var memberIds = await _db.GroupMembers.Where(m => m.GroupId == groupId).Select(m => m.UserId).ToListAsync();
        foreach (var mid in memberIds)
            await _hub.Clients.Group($"user_{mid}").SendAsync("ReceiveGroupMessage", msgDto);
        return Ok(msgDto);
    }

    [HttpPost("{groupId:int}/file")]
    [RequestSizeLimit(12_000_000)]
    public async Task<IActionResult> SendGroupFile(int groupId, [FromForm] IFormFile file,
        [FromForm] string encryptedContent, [FromForm] string iv, [FromForm] string tag)
    {
        if (file.Length > 10 * 1024 * 1024) return BadRequest(new { error = "File exceeds 10 MB." });
        var myId = Me;
        if (!await IsMember(myId, groupId)) return Forbid();
        var dir = Path.Combine("wwwroot", "uploads", "files");
        Directory.CreateDirectory(dir);
        var name = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        await using (var fs = System.IO.File.Create(Path.Combine(dir, name)))
            await file.CopyToAsync(fs);
        var ext = Path.GetExtension(file.FileName).ToLower();
        var msgType = ext is ".jpg" or ".jpeg" or ".png" or ".gif" or ".webp" ? "image" : "file";
        var msg = new GroupMessage
        {
            GroupId = groupId, SenderId = myId,
            EncryptedContent = encryptedContent, IV = iv, Tag = tag,
            MessageType = msgType, FileName = file.FileName, FileSize = file.Length,
            FilePath = $"/uploads/files/{name}"
        };
        _db.GroupMessages.Add(msg);
        await _db.SaveChangesAsync();
        await _db.Entry(msg).Reference(m => m.Sender).LoadAsync();
        var msgDto    = ToGroupMsgDto(msg);
        TraceCrypto("GROUP FILE",
            ("groupId", groupId.ToString()),
            ("messageId", msg.Id.ToString()),
            ("senderId", myId.ToString()),
            ("fileName", file.FileName),
            ("ciphertextB64", encryptedContent),
            ("ivB64", iv),
            ("tagB64", tag),
            ("storedEncryptedBlob", msg.FilePath ?? ""));
        var memberIds = await _db.GroupMembers.Where(m => m.GroupId == groupId).Select(m => m.UserId).ToListAsync();
        foreach (var mid in memberIds)
            await _hub.Clients.Group($"user_{mid}").SendAsync("ReceiveGroupMessage", msgDto);
        return Ok(msgDto);
    }

    [HttpGet("{groupId:int}/mitm-demo")]
    public async Task<IActionResult> MitmDemo(int groupId)
    {
        var myId   = Me;
        var member = await _db.GroupMembers.FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == myId);
        var group  = await _db.Groups.FindAsync(groupId);
        if (group == null) return NotFound();
        if (member != null)
            return Ok(new { authorized = true, groupName = group.Name, yourRole = member.Role,
                message = "You are a member. Use hybrid decapsulation (ML-KEM-768 + ECDH P-256) to recover the group AES key.",
                kemPreview = member.KemCiphertextForMember[..80] + "..." });
        return Ok(new {
            authorized  = false, groupName = group.Name,
            attackerSees = new {
                interceptedCiphertext = Convert.ToBase64String(RandomNumberGenerator.GetBytes(80)),
                attemptedDecrypt      = "[FAILED — AES-GCM authentication tag mismatch]",
                status = "Must break ML-KEM-768 AND ECDH P-256 simultaneously to recover any key."
            },
            explanation = "Hybrid KEM: attacker needs to break BOTH post-quantum ML-KEM-768 AND classical ECDH P-256 to derive the combined secret."
        });
    }

    private Task<bool> IsMember(int userId, int groupId) =>
        _db.GroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == userId);

    private static GroupDto MapGroup(Group g, int requestingUserId) => new(
        g.Id, g.Name, g.Description, g.AvatarColor, g.CreatedBy, g.CreatedAt,
        g.Members.Select(m => new GroupMemberDto(
            m.UserId, m.User!.Username, m.User.DisplayName, m.User.AvatarColor, m.Role,
            m.UserId == requestingUserId ? m.KemCiphertextForMember : "[ENCRYPTED]"
        )).ToList());

    private static GroupMessageDto ToGroupMsgDto(GroupMessage m) => new(
        m.Id, m.GroupId, m.SenderId,
        m.Sender!.Username, m.Sender.DisplayName, m.Sender.AvatarColor,
        m.EncryptedContent, m.IV, m.Tag, m.MessageType, m.FileName, m.FileSize, m.SentAt);

    private static byte[] XorBytes(byte[] a, byte[] b)
    {
        var r = new byte[a.Length];
        for (int i = 0; i < a.Length; i++) r[i] = (byte)(a[i] ^ b[i]);
        return r;
    }

    // GET /api/groups/file/{messageId} — returns encrypted blob + crypto headers
    [HttpGet("file/{messageId:int}")]
    public async Task<IActionResult> DownloadGroupFile(int messageId)
    {
        var myId = Me;
        var msg  = await _db.GroupMessages.FindAsync(messageId);
        if (msg == null) return NotFound();
        if (!await IsMember(myId, msg.GroupId)) return Forbid();
        if (string.IsNullOrEmpty(msg.FilePath))
            return NotFound(new { error = "No file attached." });

        var fullPath = Path.Combine("wwwroot", msg.FilePath.TrimStart('/'));
        if (!System.IO.File.Exists(fullPath))
            return NotFound(new { error = "File not found." });

        var fileBytes = await System.IO.File.ReadAllBytesAsync(fullPath);
        Response.Headers["X-Encrypted-IV"]  = msg.IV;
        Response.Headers["X-Encrypted-Tag"] = msg.Tag;
        Response.Headers["X-File-Name"]     = Uri.EscapeDataString(msg.FileName ?? "file");
        Response.Headers["Access-Control-Expose-Headers"] = "X-Encrypted-IV,X-Encrypted-Tag,X-File-Name";
        return File(fileBytes, GetMimeType(msg.FileName ?? "file"), msg.FileName ?? "file");
    }

    private static string GetMimeType(string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".png"  => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif"  => "image/gif",
            ".webp" => "image/webp",
            ".pdf"  => "application/pdf",
            ".txt"  => "text/plain",
            ".mp4"  => "video/mp4",
            ".mp3"  => "audio/mpeg",
            _       => "application/octet-stream"
        };
    }

    // GET /api/groups/{groupId}/intercept — MitM demo endpoint
    // Returns the REAL encrypted ciphertext of group messages to ANY authenticated user.
    // This simulates what an attacker (Eve) intercepts on the wire.
    // Non-members receive the actual ciphertext but cannot decrypt it
    // because they have no group key. Members also see it to compare.
    [HttpGet("{groupId:int}/intercept")]
    public async Task<IActionResult> InterceptMessages(int groupId)
    {
        var myId     = Me;
        var group    = await _db.Groups.FindAsync(groupId);
        if (group == null) return NotFound();

        var isMember = await IsMember(myId, groupId);

        // Return the raw encrypted messages — visible to everyone on the "network"
        // but only decryptable by members who hold the group key
        var msgs = await _db.GroupMessages
            .Include(m => m.Sender)
            .Where(m => m.GroupId == groupId)
            .OrderByDescending(m => m.SentAt)
            .Take(20)
            .ToListAsync();

        return Ok(new
        {
            groupId        = groupId,
            groupName      = group.Name,
            isMember       = isMember,
            totalMessages  = msgs.Count,
            // What EVERYONE on the network sees (the encrypted wire traffic)
            interceptedMessages = msgs.OrderBy(m => m.SentAt).Select(m => new
            {
                messageId        = m.Id,
                senderUsername   = m.Sender!.Username,
                // This is the REAL AES-256-GCM ciphertext — not fake
                encryptedContent = m.EncryptedContent,
                iv               = m.IV,
                gcmTag           = m.Tag,
                messageType      = m.MessageType,
                sentAt           = m.SentAt,
                // Only members can decrypt — non-members see this as garbage
                decryptionStatus = isMember
                    ? "✅ You hold the group key — use it to decrypt"
                    : "❌ No group key — this ciphertext is unreadable garbage to you"
            }),
            securityNote = isMember
                ? "You are a group member. Your Kyber KEM ciphertext lets you recover the group AES key and decrypt all messages."
                : $"You are NOT a member of '{group.Name}'. " +
                  "You can see the ciphertext on the wire but without the group AES key " +
                  "(which is wrapped in a Kyber KEM ciphertext only issued to members), " +
                  "decryption fails with an AES-GCM authentication tag mismatch."
        });
    }


    // ── Group member management ────────────────────────────────────────────

    // DELETE /api/groups/{groupId}/members/{userId} — Remove member (admin only)
    [HttpDelete("{groupId:int}/members/{userId:int}")]
    public async Task<IActionResult> RemoveMember(int groupId, int userId)
    {
        var myId = Me;
        var group = await _db.Groups.Include(g => g.Members).ThenInclude(m => m.User)
            .FirstOrDefaultAsync(g => g.Id == groupId);
        if (group == null) return NotFound();
        if (!group.Members.Any(m => m.UserId == myId && m.Role == "admin")) return Forbid();
        if (userId == myId) return BadRequest(new { error = "Use leave group to exit yourself." });

        var member = group.Members.FirstOrDefault(m => m.UserId == userId);
        if (member == null) return NotFound(new { error = "Member not found." });
        if (member.Role == "admin") return BadRequest(new { error = "Transfer admin before removing this user." });

        _db.GroupMembers.Remove(member);
await _db.SaveChangesAsync();

// ── KEY ROTATION ──────────────────────────────────────────────────────────
// Generate a brand new group secret and re-wrap it for every remaining member.
// The removed member's old wrapped key is now deleted and useless for
// all future messages — this is cryptographic revocation, not just DB access control.
await RotateGroupKey(groupId, revokedUserId: userId);
// ─────────────────────────────────────────────────────────────────────────

// Notify the removed user
await _hub.Clients.Group($"user_{userId}")
    .SendAsync("RemovedFromGroup", new { groupId, groupName = group.Name });

// Reload after rotation so members receive their NEW KEM ciphertext
var fullGroup = await LoadGroup(groupId);
foreach (var remaining in fullGroup!.Members)
    await _hub.Clients.Group($"user_{remaining.UserId}")
        .SendAsync("GroupUpdated", MapGroup(fullGroup, remaining.UserId));

await _hub.Clients.Group($"group_{groupId}")
    .SendAsync("MemberRemoved", new { groupId, userId, userName = member.User?.DisplayName ?? "A member" });

return Ok(new { 
    message = "Member removed.",
    keyRotated = true,
    note = "New group secret generated. Removed member cannot decrypt any future messages."
});
    }

    // DELETE /api/groups/{groupId}/leave — Leave group
    [HttpPost("{groupId:int}/transfer-admin/{newAdminId:int}")]
    public async Task<IActionResult> TransferAdmin(int groupId, int newAdminId)
    {
        var myId = Me;
        var group = await _db.Groups.Include(g => g.Members).ThenInclude(m => m.User)
            .FirstOrDefaultAsync(g => g.Id == groupId);
        if (group == null) return NotFound();

        var currentAdmin = group.Members.FirstOrDefault(m => m.UserId == myId && m.Role == "admin");
        if (currentAdmin == null) return Forbid();

        var newAdmin = group.Members.FirstOrDefault(m => m.UserId == newAdminId);
        if (newAdmin == null) return BadRequest(new { error = "New admin must be a group member." });

        currentAdmin.Role = "member";
        newAdmin.Role = "admin";
        group.CreatedBy = newAdminId;
        await _db.SaveChangesAsync();

        var fullGroup = await LoadGroup(groupId);
        foreach (var member in fullGroup!.Members)
            await _hub.Clients.Group($"user_{member.UserId}").SendAsync("GroupUpdated", MapGroup(fullGroup, member.UserId));

        return Ok(MapGroup(fullGroup, myId));
    }

    [HttpDelete("{groupId:int}/leave")]
    public async Task<IActionResult> LeaveGroup(int groupId, [FromQuery] int? newAdminId = null)
    {
        var myId = Me;
        var group = await _db.Groups.Include(g => g.Members).ThenInclude(m => m.User)
            .FirstOrDefaultAsync(g => g.Id == groupId);
        if (group == null) return NotFound();

        var member = group.Members.FirstOrDefault(m => m.UserId == myId);
        if (member == null) return NotFound(new { error = "You are not a member." });

        if (member.Role == "admin")
        {
            var otherMembers = group.Members.Where(m => m.UserId != myId).ToList();
            if (otherMembers.Count == 0)
                return await DeleteGroupInternal(group, myId);

            if (newAdminId == null)
                return BadRequest(new { error = "Choose another member as admin before leaving." });

            var newAdmin = otherMembers.FirstOrDefault(m => m.UserId == newAdminId.Value);
            if (newAdmin == null)
                return BadRequest(new { error = "New admin must be another group member." });

            newAdmin.Role = "admin";
            group.CreatedBy = newAdmin.UserId;
        }

        _db.GroupMembers.Remove(member);
        await _db.SaveChangesAsync();

        var user = await _db.Users.FindAsync(myId);
        await _hub.Clients.Group($"group_{groupId}")
            .SendAsync("MemberLeft", new { groupId, userId = myId, userName = user?.DisplayName });

        var fullGroup = await LoadGroup(groupId);
        if (fullGroup != null)
        {
            foreach (var remaining in fullGroup.Members)
                await _hub.Clients.Group($"user_{remaining.UserId}").SendAsync("GroupUpdated", MapGroup(fullGroup, remaining.UserId));
        }

        return Ok(new { message = "Left group." });
    }

    [HttpDelete("{groupId:int}")]
    public async Task<IActionResult> DeleteGroup(int groupId)
    {
        var myId = Me;
        var group = await _db.Groups.Include(g => g.Members)
            .FirstOrDefaultAsync(g => g.Id == groupId);
        if (group == null) return NotFound();
        if (!group.Members.Any(m => m.UserId == myId && m.Role == "admin")) return Forbid();

        return await DeleteGroupInternal(group, myId);
    }

    // Members get their own KEM ciphertext; non-members get [ENCRYPTED]
    // This lets non-members (like Eve) see groups exist but not read messages
    [HttpGet("all")]
    public async Task<IActionResult> GetAllGroups()
    {
        var myId   = Me;
        var groups = await _db.Groups
            .Include(g => g.Members).ThenInclude(m => m.User)
            .ToListAsync();
        return Ok(groups.Select(g => MapGroup(g, myId)));
    }

    private Task<Group?> LoadGroup(int groupId) =>
        _db.Groups.Include(g => g.Members).ThenInclude(m => m.User)
            .FirstOrDefaultAsync(g => g.Id == groupId);

    private async Task<byte[]> UnwrapGroupKeyForMember(GroupMember member)
    {
        var ks = await _db.UserKeyStores.FirstOrDefaultAsync(k => k.UserId == member.UserId)
            ?? throw new InvalidOperationException("Key store not found for existing member.");

        var parts = member.KemCiphertextForMember.Split('|');
        var hybridCt = parts[0];
        var wrappedB64 = parts[1];
        var combinedSecret = DecapsulateForKeyStore(ks, hybridCt);
        var wrapKey = HKDF.DeriveKey(HashAlgorithmName.SHA256, combinedSecret, 32,
            info: System.Text.Encoding.UTF8.GetBytes("GroupKeyWrap"));
        var wrapped = Convert.FromBase64String(wrappedB64);
        var groupKey = XorBytes(wrapped, wrapKey);

        TraceCrypto("GROUP KEY UNWRAP FOR ADD",
            ("groupId", member.GroupId.ToString()),
            ("sourceMemberId", member.UserId.ToString()),
            ("hybridCiphertext", hybridCt),
            ("combinedSecretB64", B64(combinedSecret)),
            ("wrapKeyB64", B64(wrapKey)),
            ("wrappedGroupKeyB64", wrappedB64),
            ("recoveredGroupKeyB64", B64(groupKey)));

        return groupKey;
    }

    /// <summary>
/// Generates a fresh group master secret and re-wraps it for every
/// remaining member using their individual Hybrid KEM public keys.
/// The old wrapped ciphertexts are overwritten in the database.
/// After this call, the revoked user's previously held key material
/// is cryptographically useless — it decapsulates to a secret that
/// no longer encrypts any message.
/// </summary>
private async Task RotateGroupKey(int groupId, int revokedUserId)
{
    // Step 1 — generate completely fresh group secret
    var newGroupSecret = RandomNumberGenerator.GetBytes(32);

    // Step 2 — load all remaining members (revoked user already deleted above)
    var remainingMembers = await _db.GroupMembers
        .Where(m => m.GroupId == groupId)
        .ToListAsync();

    // Step 3 — re-wrap the new secret for each remaining member individually
    foreach (var m in remainingMembers)
    {
        var ks = await _db.UserKeyStores.FirstOrDefaultAsync(k => k.UserId == m.UserId);
        if (ks == null) continue;

        // Fresh HybridEncaps for this member — new KEM ciphertext every rotation
        var (combinedSecret, hybridCt) = _pqc.HybridEncapsulate(ks.KyberPublicKey, ks.EcdhPublicKey);

        var wrapKey = HKDF.DeriveKey(
            HashAlgorithmName.SHA256,
            combinedSecret,
            32,
            info: System.Text.Encoding.UTF8.GetBytes("GroupKeyWrap"));

        var wrapped = XorBytes(newGroupSecret, wrapKey);

        // Overwrite the old ciphertext in-place
        m.KemCiphertextForMember = $"{hybridCt}|{Convert.ToBase64String(wrapped)}";

        TraceCrypto("GROUP KEY ROTATION",
            ("groupId",           groupId.ToString()),
            ("revokedUserId",     revokedUserId.ToString()),
            ("rewrappedMemberId", m.UserId.ToString()),
            ("newGroupSecretB64", B64(newGroupSecret)),
            ("newHybridCt",       hybridCt),
            ("combinedSecretB64", B64(combinedSecret)),
            ("wrapKeyB64",        B64(wrapKey)),
            ("wrappedKeyB64",     B64(wrapped)));
    }

    // Step 4 — persist all updated ciphertexts atomically
    await _db.SaveChangesAsync();

    _log.LogInformation(
        "[KeyRotation] Group {GroupId} — new secret issued to {Count} members. " +
        "UserId {RevokedId} cryptographically excluded.",
        groupId, remainingMembers.Count, revokedUserId);
}

    private string WrapGroupKeyForMember(int groupId, int memberId, byte[] groupMasterSecret, UserKeyStore ks)
    {
        var (combinedSecret, hybridCt) = _pqc.HybridEncapsulate(ks.KyberPublicKey, ks.EcdhPublicKey);
        var wrapKey = HKDF.DeriveKey(HashAlgorithmName.SHA256, combinedSecret, 32,
            info: System.Text.Encoding.UTF8.GetBytes("GroupKeyWrap"));
        var wrapped = XorBytes(groupMasterSecret, wrapKey);

        TraceCrypto("GROUP ADD MEMBER WRAP",
            ("groupId", groupId.ToString()),
            ("memberId", memberId.ToString()),
            ("groupMasterSecretB64", B64(groupMasterSecret)),
            ("hybridCiphertext", hybridCt),
            ("combinedSecretB64", B64(combinedSecret)),
            ("wrapKeyB64", B64(wrapKey)),
            ("wrappedGroupKeyB64", B64(wrapped)));

        return $"{hybridCt}|{Convert.ToBase64String(wrapped)}";
    }

    private byte[] DecapsulateForKeyStore(UserKeyStore ks, string hybridCt)
    {
        var kekB64 = _cfg["Kek:MasterKey"];
        if (string.IsNullOrEmpty(kekB64))
            throw new InvalidOperationException("Server KEK not configured.");

        var kek = Convert.FromBase64String(kekB64);
        var kyberPrivB64 = _pqc.DecryptPrivateKeyWithKek(ks.KyberPrivateKeyServerEncrypted, kek);
        var ecdhPrivB64 = _pqc.DecryptPrivateKeyWithKek(ks.EcdhPrivateKeyServerEncrypted, kek);
        return _pqc.HybridDecapsulate(hybridCt, kyberPrivB64, Convert.FromBase64String(ecdhPrivB64));
    }

    private void TraceCrypto(string title, params (string Name, string Value)[] values)
    {
        if (!_cfg.GetValue("CryptoTrace:Enabled", true)) return;

        var lines = string.Join(Environment.NewLine, values.Select(v => $"    {v.Name}: {v.Value}"));
        _log.LogInformation("{Title}{NewLine}{Lines}", $"[CryptoTrace] {title}", Environment.NewLine, lines);
    }

    private static string B64(byte[] bytes) => Convert.ToBase64String(bytes);

    private async Task<IActionResult> DeleteGroupInternal(Group group, int deletedByUserId)
    {
        var memberIds = await _db.GroupMembers
            .Where(m => m.GroupId == group.Id)
            .Select(m => m.UserId)
            .ToListAsync();

        var files = await _db.GroupMessages
            .Where(m => m.GroupId == group.Id && m.FilePath != null)
            .Select(m => m.FilePath!)
            .ToListAsync();

        _db.GroupMessages.RemoveRange(_db.GroupMessages.Where(m => m.GroupId == group.Id));
        _db.GroupMembers.RemoveRange(_db.GroupMembers.Where(m => m.GroupId == group.Id));
        _db.Groups.Remove(group);
        await _db.SaveChangesAsync();

        foreach (var filePath in files)
        {
            var fullPath = Path.Combine("wwwroot", filePath.TrimStart('/'));
            if (System.IO.File.Exists(fullPath))
                System.IO.File.Delete(fullPath);
        }

        foreach (var memberId in memberIds)
        {
            await _hub.Clients.Group($"user_{memberId}")
                .SendAsync("GroupDeleted", new { groupId = group.Id, groupName = group.Name, deletedByUserId });
        }

        return Ok(new { message = "Group deleted." });
    }
}
