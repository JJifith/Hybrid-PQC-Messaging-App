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
[Route("api/friends")]
[Authorize]
public class FriendsController : ControllerBase
{
    private readonly AppDbContext         _db;
    private readonly IHubContext<ChatHub> _hub;
    private readonly HybridPqcService     _pqc;
    private readonly IConfiguration       _cfg;
    private readonly ILogger<FriendsController> _log;

    public FriendsController(AppDbContext db, IHubContext<ChatHub> hub, HybridPqcService pqc,
        IConfiguration cfg, ILogger<FriendsController> log)
    { _db = db; _hub = hub; _pqc = pqc; _cfg = cfg; _log = log; }

    private int Me => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("requests")]
    public async Task<IActionResult> GetRequests()
    {
        var myId = Me;
        var reqs = await _db.FriendRequests
            .Include(r => r.Sender).Include(r => r.Receiver)
            .Where(r => (r.SenderId == myId || r.ReceiverId == myId) && r.Status == "pending")
            .OrderByDescending(r => r.CreatedAt).ToListAsync();

        return Ok(reqs.Select(r => new FriendRequestDto(r.Id,
            new UserDto(r.Sender!.Id, r.Sender.Username, r.Sender.DisplayName, r.Sender.AvatarColor, r.Sender.IsOnline, r.Sender.LastSeen),
            new UserDto(r.Receiver!.Id, r.Receiver.Username, r.Receiver.DisplayName, r.Receiver.AvatarColor, r.Receiver.IsOnline, r.Receiver.LastSeen),
            r.Status, r.CreatedAt)));
    }

    [HttpPost("request")]
    public async Task<IActionResult> SendRequest([FromBody] SendFriendRequestDto dto)
    {
        var myId = Me;
        if (myId == dto.ReceiverId) return BadRequest(new { error = "Cannot add yourself." });
        if (!await _db.Users.AnyAsync(u => u.Id == dto.ReceiverId))
            return NotFound(new { error = "User not found." });
        if (await _db.FriendRequests.AnyAsync(r => r.SenderId == myId && r.ReceiverId == dto.ReceiverId && r.Status == "pending"))
            return Conflict(new { error = "Request already sent." });
        if (await _db.Friendships.AnyAsync(f => (f.User1Id == myId && f.User2Id == dto.ReceiverId) || (f.User1Id == dto.ReceiverId && f.User2Id == myId)))
            return Conflict(new { error = "Already friends." });

        var req = new FriendRequest { SenderId = myId, ReceiverId = dto.ReceiverId };
        _db.FriendRequests.Add(req);
        await _db.SaveChangesAsync();

        var sender = await _db.Users.FindAsync(myId);
        await _hub.Clients.Group($"user_{dto.ReceiverId}").SendAsync("FriendRequestReceived", new FriendRequestDto(req.Id,
            new UserDto(sender!.Id, sender.Username, sender.DisplayName, sender.AvatarColor, sender.IsOnline, sender.LastSeen),
            new UserDto(dto.ReceiverId, "", "", "", false, DateTime.UtcNow), "pending", req.CreatedAt));

        return Ok(new { requestId = req.Id });
    }

    [HttpPost("respond")]
    public async Task<IActionResult> RespondToRequest([FromBody] RespondFriendRequestDto dto)
    {
        var myId = Me;
        var req  = await _db.FriendRequests.Include(r => r.Sender)
                       .FirstOrDefaultAsync(r => r.Id == dto.RequestId && r.ReceiverId == myId);

        if (req == null)             return NotFound(new { error = "Request not found." });
        if (req.Status != "pending") return Conflict(new { error = "Already handled." });

        req.Status = dto.Action == "accept" ? "accepted" : "rejected";

        if (dto.Action == "accept")
        {
            var senderKs   = await _db.UserKeyStores.FirstAsync(k => k.UserId == req.SenderId);
            var receiverKs = await _db.UserKeyStores.FirstAsync(k => k.UserId == myId);

            // One shared friendship key, wrapped with hybrid KEM for each user
            var friendshipKey = RandomNumberGenerator.GetBytes(32);

            // Wrap for sender using their Kyber + ECDH public keys
            var (combinedSender, hybridCtSender)     = _pqc.HybridEncapsulate(senderKs.KyberPublicKey,   senderKs.EcdhPublicKey);
            var wrapKeySender                        = HKDF.DeriveKey(HashAlgorithmName.SHA256, combinedSender, 32, info: System.Text.Encoding.UTF8.GetBytes("FriendKeyWrap"));
            var storedForSender                      = $"{hybridCtSender}|{Convert.ToBase64String(XorBytes(friendshipKey, wrapKeySender))}";
            TraceCrypto("FRIEND KEY WRAP SENDER",
                ("senderId", req.SenderId.ToString()),
                ("receiverId", myId.ToString()),
                ("friendshipKeyB64", B64(friendshipKey)),
                ("hybridCiphertext", hybridCtSender),
                ("combinedSecretB64", B64(combinedSender)),
                ("wrapKeyB64", B64(wrapKeySender)),
                ("wrappedFriendKeyB64", storedForSender.Split('|')[1]));

            // Wrap for receiver using their Kyber + ECDH public keys
            var (combinedReceiver, hybridCtReceiver) = _pqc.HybridEncapsulate(receiverKs.KyberPublicKey, receiverKs.EcdhPublicKey);
            var wrapKeyReceiver                      = HKDF.DeriveKey(HashAlgorithmName.SHA256, combinedReceiver, 32, info: System.Text.Encoding.UTF8.GetBytes("FriendKeyWrap"));
            var storedForReceiver                    = $"{hybridCtReceiver}|{Convert.ToBase64String(XorBytes(friendshipKey, wrapKeyReceiver))}";
            TraceCrypto("FRIEND KEY WRAP RECEIVER",
                ("senderId", req.SenderId.ToString()),
                ("receiverId", myId.ToString()),
                ("friendshipKeyB64", B64(friendshipKey)),
                ("hybridCiphertext", hybridCtReceiver),
                ("combinedSecretB64", B64(combinedReceiver)),
                ("wrapKeyB64", B64(wrapKeyReceiver)),
                ("wrappedFriendKeyB64", storedForReceiver.Split('|')[1]));

            var friendship = new Friendship
            {
                User1Id = req.SenderId, User2Id = myId,
                KemCiphertextForUser1 = storedForSender,
                KemCiphertextForUser2 = storedForReceiver,
            };
            _db.Friendships.Add(friendship);
            await _db.SaveChangesAsync();

            var receiver = await _db.Users.FindAsync(myId);
            await _hub.Clients.Group($"user_{req.SenderId}").SendAsync("FriendRequestAccepted", new
            {
                friendshipId  = friendship.Id,
                friend        = new UserDto(receiver!.Id, receiver.Username, receiver.DisplayName, receiver.AvatarColor, receiver.IsOnline, receiver.LastSeen),
                kemCiphertext = storedForSender
            });

            return Ok(new { friendshipId = friendship.Id, kemCiphertext = storedForReceiver });
        }

        await _db.SaveChangesAsync();
        return Ok(new { status = "rejected" });
    }

    private static byte[] XorBytes(byte[] a, byte[] b)
    {
        var r = new byte[a.Length];
        for (int i = 0; i < a.Length; i++) r[i] = (byte)(a[i] ^ b[i]);
        return r;
    }

    private void TraceCrypto(string title, params (string Name, string Value)[] values)
    {
        if (!_cfg.GetValue("CryptoTrace:Enabled", true)) return;

        var lines = string.Join(Environment.NewLine, values.Select(v => $"    {v.Name}: {v.Value}"));
        _log.LogInformation("{Title}{NewLine}{Lines}", $"[CryptoTrace] {title}", Environment.NewLine, lines);
    }

    private static string B64(byte[] bytes) => Convert.ToBase64String(bytes);
}
