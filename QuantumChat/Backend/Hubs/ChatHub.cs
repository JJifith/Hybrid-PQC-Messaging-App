using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using QuantumChat.Data;
using System.Security.Claims;

namespace QuantumChat.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private readonly AppDbContext _db;
    public ChatHub(AppDbContext db) => _db = db;

    public override async Task OnConnectedAsync()
    {
        var userId = GetUserId();
        if (userId == null) return;

        await Groups.AddToGroupAsync(Context.ConnectionId, $"user_{userId}");

        var user = await _db.Users.FindAsync(int.Parse(userId));
        if (user != null)
        {
            user.IsOnline = true;
            user.LastSeen = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        var groupIds = await _db.GroupMembers
            .Where(m => m.UserId == int.Parse(userId))
            .Select(m => m.GroupId)
            .ToListAsync();

        foreach (var gid in groupIds)
            await Groups.AddToGroupAsync(Context.ConnectionId, $"group_{gid}");

        await BroadcastPresence(int.Parse(userId), true);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? ex)
    {
        var userId = GetUserId();
        if (userId != null)
        {
            var user = await _db.Users.FindAsync(int.Parse(userId));
            if (user != null)
            {
                user.IsOnline = false;
                user.LastSeen = DateTime.UtcNow;
                await _db.SaveChangesAsync();
            }
            await BroadcastPresence(int.Parse(userId), false);
        }
        await base.OnDisconnectedAsync(ex);
    }

    public async Task MarkRead(int fromUserId)
    {
        var myId = int.Parse(GetUserId()!);
        var msgs = await _db.Messages
            .Where(m => m.SenderId == fromUserId && m.ReceiverId == myId && !m.IsRead)
            .ToListAsync();

        if (msgs.Count == 0) return;
        msgs.ForEach(m => m.IsRead = true);
        await _db.SaveChangesAsync();
        await Clients.Group($"user_{fromUserId}").SendAsync("MessagesRead", new { byUserId = myId });
    }

    public async Task Typing(int toUserId, bool isTyping)
    {
        var myId = GetUserId();
        await Clients.Group($"user_{toUserId}")
            .SendAsync("UserTyping", new { fromUserId = int.Parse(myId!), isTyping });
    }

    public async Task GroupTyping(int groupId, bool isTyping)
    {
        var myId = int.Parse(GetUserId()!);
        var isMember = await _db.GroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == myId);
        if (!isMember) return;
        await Clients.Group($"group_{groupId}")
            .SendAsync("GroupTyping", new { fromUserId = myId, groupId, isTyping });
    }

    public async Task JoinGroup(int groupId)
    {
        var myId = int.Parse(GetUserId()!);
        var isMember = await _db.GroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == myId);
        if (isMember)
            await Groups.AddToGroupAsync(Context.ConnectionId, $"group_{groupId}");
    }

    private string? GetUserId() => Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);

    private async Task BroadcastPresence(int userId, bool isOnline)
    {
        var friendIds = await _db.Friendships
            .Where(f => f.User1Id == userId || f.User2Id == userId)
            .Select(f => f.User1Id == userId ? f.User2Id : f.User1Id)
            .ToListAsync();

        foreach (var fid in friendIds)
            await Clients.Group($"user_{fid}")
                .SendAsync("UserPresence", new { userId, isOnline, lastSeen = DateTime.UtcNow });
    }
}
