using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using QuantumChat.Data;
using QuantumChat.DTOs;
using QuantumChat.Hubs;
using System.Security.Claims;

namespace QuantumChat.Controllers;

[ApiController]
[Route("api/messages")]
[Authorize]
public class MessagesController : ControllerBase
{
    private readonly AppDbContext      _db;
    private readonly IHubContext<ChatHub> _hub;
    private readonly IConfiguration _cfg;
    private readonly ILogger<MessagesController> _log;

    public MessagesController(AppDbContext db, IHubContext<ChatHub> hub,
        IConfiguration cfg, ILogger<MessagesController> log)
    {
        _db = db; _hub = hub; _cfg = cfg; _log = log;
    }

    private int Me => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // GET /api/messages/{friendId}?page=1&size=50
    [HttpGet("{friendId:int}")]
    public async Task<IActionResult> GetMessages(int friendId, [FromQuery] int page = 1, [FromQuery] int size = 50)
    {
        var myId = Me;

        // Only friends can read each other's messages
        if (!await AreFriends(myId, friendId))
            return Forbid();

        var msgs = await _db.Messages
            .Include(m => m.Sender)
            .Where(m =>
                (m.SenderId == myId && m.ReceiverId == friendId) ||
                (m.SenderId == friendId && m.ReceiverId == myId))
            .OrderByDescending(m => m.SentAt)
            .Skip((page - 1) * size).Take(size)
            .ToListAsync();

        // Mark unread messages as read
        var unread = msgs.Where(m => m.ReceiverId == myId && !m.IsRead).ToList();
        if (unread.Count > 0)
        {
            unread.ForEach(m => m.IsRead = true);
            await _db.SaveChangesAsync();
            await _hub.Clients.Group($"user_{friendId}")
                .SendAsync("MessagesRead", new { byUserId = myId });
        }

        return Ok(msgs.OrderBy(m => m.SentAt).Select(ToDto));
    }

    // POST /api/messages
    [HttpPost]
    public async Task<IActionResult> SendMessage([FromBody] SendMessageDto dto)
    {
        var myId = Me;
        if (!await AreFriends(myId, dto.ReceiverId))
            return Forbid();

        var msg = new Message
        {
            SenderId         = myId,
            ReceiverId       = dto.ReceiverId,
            EncryptedContent = dto.EncryptedContent,
            IV               = dto.IV,
            Tag              = dto.Tag,
            MessageType      = dto.MessageType,
            FileName         = dto.FileName,
            FileSize         = dto.FileSize
        };

        _db.Messages.Add(msg);
        await _db.SaveChangesAsync();
        await _db.Entry(msg).Reference(m => m.Sender).LoadAsync();

        var dto2 = ToDto(msg);
        TraceCrypto("FRIEND MESSAGE",
            ("messageId", msg.Id.ToString()),
            ("senderId", myId.ToString()),
            ("receiverId", dto.ReceiverId.ToString()),
            ("messageType", msg.MessageType),
            ("ciphertextB64", dto.EncryptedContent),
            ("ivB64", dto.IV),
            ("tagB64", dto.Tag),
            ("note", "Friendship AES key stays client-side; backend receives ciphertext/IV/tag only."));
        await _hub.Clients.Group($"user_{dto.ReceiverId}").SendAsync("ReceiveMessage", dto2);
        await _hub.Clients.Group($"user_{myId}").SendAsync("MessageSent", dto2);  // multi-tab support

        return Ok(dto2);
    }

    // POST /api/messages/file  — multipart, max 10 MB
    [HttpPost("file")]
    [RequestSizeLimit(12_000_000)]
    public async Task<IActionResult> SendFile(
        [FromForm] IFormFile file,
        [FromForm] int receiverId,
        [FromForm] string encryptedContent,
        [FromForm] string iv,
        [FromForm] string tag)
    {
        if (file.Length > 10 * 1024 * 1024)
            return BadRequest(new { error = "File exceeds 10 MB limit." });

        var myId = Me;
        if (!await AreFriends(myId, receiverId))
            return Forbid();

        // Save the encrypted file blob to disk
        var uploadsDir = Path.Combine("wwwroot", "uploads", "files");
        Directory.CreateDirectory(uploadsDir);
        var storedName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var fullPath   = Path.Combine(uploadsDir, storedName);

        await using (var fs = System.IO.File.Create(fullPath))
            await file.CopyToAsync(fs);

        var msgType = IsImage(file.FileName) ? "image" : "file";
        var msg = new Message
        {
            SenderId         = myId,
            ReceiverId       = receiverId,
            EncryptedContent = encryptedContent,
            IV               = iv,
            Tag              = tag,
            MessageType      = msgType,
            FileName         = file.FileName,
            FileSize         = file.Length,
            FilePath         = $"/uploads/files/{storedName}"
        };

        _db.Messages.Add(msg);
        await _db.SaveChangesAsync();
        await _db.Entry(msg).Reference(m => m.Sender).LoadAsync();

        var dto = ToDto(msg);
        TraceCrypto("FRIEND FILE",
            ("messageId", msg.Id.ToString()),
            ("senderId", myId.ToString()),
            ("receiverId", receiverId.ToString()),
            ("fileName", file.FileName),
            ("ciphertextB64", encryptedContent),
            ("ivB64", iv),
            ("tagB64", tag),
            ("storedEncryptedBlob", msg.FilePath ?? ""));
        await _hub.Clients.Group($"user_{receiverId}").SendAsync("ReceiveMessage", dto);
        return Ok(dto);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private Task<bool> AreFriends(int a, int b) =>
        _db.Friendships.AnyAsync(f =>
            (f.User1Id == a && f.User2Id == b) ||
            (f.User1Id == b && f.User2Id == a));

    private static bool IsImage(string fn)
    {
        var ext = Path.GetExtension(fn).ToLowerInvariant();
        return ext is ".jpg" or ".jpeg" or ".png" or ".gif" or ".webp" or ".avif";
    }

    private static MessageDto ToDto(Message m) => new(
        m.Id, m.SenderId, m.ReceiverId,
        m.Sender!.Username, m.Sender.DisplayName, m.Sender.AvatarColor,
        m.EncryptedContent, m.IV, m.Tag,
        m.MessageType, m.FileName, m.FileSize,
        m.SentAt, m.IsRead
    );

    private void TraceCrypto(string title, params (string Name, string Value)[] values)
    {
        if (!_cfg.GetValue("CryptoTrace:Enabled", true)) return;

        var lines = string.Join(Environment.NewLine, values.Select(v => $"    {v.Name}: {v.Value}"));
        _log.LogInformation("{Title}{NewLine}{Lines}", $"[CryptoTrace] {title}", Environment.NewLine, lines);
    }

    // GET /api/messages/file/{messageId} — returns encrypted blob + crypto headers
    [HttpGet("file/{messageId:int}")]
    public async Task<IActionResult> DownloadFile(int messageId)
    {
        var myId = Me;
        var msg  = await _db.Messages.FindAsync(messageId);
        if (msg == null) return NotFound();
        if (msg.SenderId != myId && msg.ReceiverId != myId) return Forbid();
        if (string.IsNullOrEmpty(msg.FilePath))
            return NotFound(new { error = "No file attached." });

        var fullPath = Path.Combine("wwwroot", msg.FilePath.TrimStart('/'));
        if (!System.IO.File.Exists(fullPath))
            return NotFound(new { error = "File not found on server." });

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
}
