using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuantumChat.Data;
using QuantumChat.DTOs;
using System.Security.Claims;

namespace QuantumChat.Controllers;

[ApiController]
[Route("api/users")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _db;
    public UsersController(AppDbContext db) => _db = db;
    private int Me => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<IActionResult> SearchUsers([FromQuery] string? search)
    {
        var myId = Me;
        var q = _db.Users.Where(u => u.Id != myId).AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
            q = q.Where(u => u.Username.Contains(search) || u.DisplayName.Contains(search));
        var users = await q.OrderBy(u => u.Username).Take(100).ToListAsync();

        var friendIds    = await _db.Friendships.Where(f => f.User1Id == myId || f.User2Id == myId)
                               .Select(f => f.User1Id == myId ? f.User2Id : f.User1Id).ToListAsync();
        var sentIds      = await _db.FriendRequests.Where(r => r.SenderId == myId && r.Status == "pending")
                               .Select(r => r.ReceiverId).ToListAsync();
        var receivedIds  = await _db.FriendRequests.Where(r => r.ReceiverId == myId && r.Status == "pending")
                               .Select(r => r.SenderId).ToListAsync();

        return Ok(users.Select(u => new UserSearchDto(
            u.Id, u.Username, u.DisplayName, u.AvatarColor, u.IsOnline, u.LastSeen,
            friendIds.Contains(u.Id)   ? "friend"
          : sentIds.Contains(u.Id)     ? "request_sent"
          : receivedIds.Contains(u.Id) ? "request_received" : "none"
        )));
    }

    // Returns BOTH public keys (Kyber + ECDH) for hybrid KEM
    [HttpGet("{id:int}/publickey")]
    public async Task<IActionResult> GetPublicKey(int id)
    {
        var ks = await _db.UserKeyStores.FirstOrDefaultAsync(k => k.UserId == id);
        return ks == null ? NotFound() : Ok(new UserPublicKeyDto(id, ks.KyberPublicKey, ks.EcdhPublicKey));
    }

    [HttpGet("friends")]
    public async Task<IActionResult> GetFriends()
    {
        var myId = Me;
        var friendships = await _db.Friendships
            .Include(f => f.User1).Include(f => f.User2)
            .Where(f => f.User1Id == myId || f.User2Id == myId)
            .ToListAsync();

        return Ok(friendships.Select(f => {
            var isUser1 = f.User1Id == myId;
            var friend  = isUser1 ? f.User2! : f.User1!;
            var kem     = isUser1 ? f.KemCiphertextForUser1 : f.KemCiphertextForUser2;
            return new FriendDto(f.Id,
                new UserDto(friend.Id, friend.Username, friend.DisplayName,
                            friend.AvatarColor, friend.IsOnline, friend.LastSeen), kem);
        }));
    }

    [HttpGet("me")]
    public async Task<IActionResult> GetMe()
    {
        var user = await _db.Users.FindAsync(Me);
        return user == null ? NotFound()
            : Ok(new UserDto(user.Id, user.Username, user.DisplayName,
                             user.AvatarColor, user.IsOnline, user.LastSeen));
    }

    [HttpDelete("me")]
    public async Task<IActionResult> DeleteMe()
    {
        var myId = Me;
        var user = await _db.Users.FindAsync(myId);
        if (user == null) return NotFound();

        var directFiles = await _db.Messages
            .Where(m => (m.SenderId == myId || m.ReceiverId == myId) && m.FilePath != null)
            .Select(m => m.FilePath!)
            .ToListAsync();

        var createdGroupIds = await _db.Groups
            .Where(g => g.CreatedBy == myId)
            .Select(g => g.Id)
            .ToListAsync();

        var groupFiles = await _db.GroupMessages
            .Where(m => (m.SenderId == myId || createdGroupIds.Contains(m.GroupId)) && m.FilePath != null)
            .Select(m => m.FilePath!)
            .ToListAsync();

        _db.Messages.RemoveRange(_db.Messages.Where(m => m.SenderId == myId || m.ReceiverId == myId));
        _db.GroupMessages.RemoveRange(_db.GroupMessages.Where(m => m.SenderId == myId || createdGroupIds.Contains(m.GroupId)));
        _db.GroupMembers.RemoveRange(_db.GroupMembers.Where(m => m.UserId == myId || createdGroupIds.Contains(m.GroupId)));
        _db.Groups.RemoveRange(_db.Groups.Where(g => g.CreatedBy == myId));
        _db.Friendships.RemoveRange(_db.Friendships.Where(f => f.User1Id == myId || f.User2Id == myId));
        _db.FriendRequests.RemoveRange(_db.FriendRequests.Where(r => r.SenderId == myId || r.ReceiverId == myId));
        _db.UserKeyStores.RemoveRange(_db.UserKeyStores.Where(k => k.UserId == myId));
        _db.Users.Remove(user);

        await _db.SaveChangesAsync();

        foreach (var filePath in directFiles.Concat(groupFiles).Distinct())
            TryDeleteUpload(filePath);

        return Ok(new { message = "Account deleted." });
    }

    private static void TryDeleteUpload(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath)) return;

        var relative = filePath.TrimStart('/', '\\')
            .Replace('/', Path.DirectorySeparatorChar)
            .Replace('\\', Path.DirectorySeparatorChar);
        var fullPath = Path.GetFullPath(Path.Combine("wwwroot", relative));
        var uploadsRoot = Path.GetFullPath(Path.Combine("wwwroot", "uploads", "files"));

        if (!fullPath.StartsWith(uploadsRoot, StringComparison.OrdinalIgnoreCase)) return;
        if (System.IO.File.Exists(fullPath)) System.IO.File.Delete(fullPath);
    }
}
