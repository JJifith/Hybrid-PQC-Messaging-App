using Microsoft.EntityFrameworkCore;

namespace QuantumChat.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<UserKeyStore> UserKeyStores => Set<UserKeyStore>();
    public DbSet<FriendRequest> FriendRequests => Set<FriendRequest>();
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<Group> Groups => Set<Group>();
    public DbSet<GroupMember> GroupMembers => Set<GroupMember>();
    public DbSet<GroupMessage> GroupMessages => Set<GroupMessage>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>()
            .HasIndex(u => u.Username)
            .IsUnique();

        b.Entity<UserKeyStore>()
            .HasIndex(k => k.UserId)
            .IsUnique();

        b.Entity<FriendRequest>()
            .HasIndex(r => new { r.SenderId, r.ReceiverId })
            .IsUnique();

        b.Entity<Friendship>()
            .HasIndex(f => new { f.User1Id, f.User2Id })
            .IsUnique();

        b.Entity<GroupMember>()
            .HasIndex(m => new { m.GroupId, m.UserId })
            .IsUnique();

        // Navigation properties — avoid cascade delete cycles
        b.Entity<FriendRequest>()
            .HasOne(r => r.Sender).WithMany().HasForeignKey(r => r.SenderId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<FriendRequest>()
            .HasOne(r => r.Receiver).WithMany().HasForeignKey(r => r.ReceiverId).OnDelete(DeleteBehavior.Restrict);

        b.Entity<Friendship>()
            .HasOne(f => f.User1).WithMany().HasForeignKey(f => f.User1Id).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Friendship>()
            .HasOne(f => f.User2).WithMany().HasForeignKey(f => f.User2Id).OnDelete(DeleteBehavior.Restrict);

        b.Entity<Message>()
            .HasOne(m => m.Sender).WithMany().HasForeignKey(m => m.SenderId).OnDelete(DeleteBehavior.Restrict);

        b.Entity<GroupMember>()
            .HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<GroupMember>()
            .HasOne(m => m.Group).WithMany(g => g.Members).HasForeignKey(m => m.GroupId);

        b.Entity<GroupMessage>()
            .HasOne(m => m.Sender).WithMany().HasForeignKey(m => m.SenderId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<GroupMessage>()
            .HasOne(m => m.Group).WithMany().HasForeignKey(m => m.GroupId);
    }
}
