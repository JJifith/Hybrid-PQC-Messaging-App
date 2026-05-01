using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuantumChat.Crypto;
using QuantumChat.Data;
using QuantumChat.DTOs;
using QuantumChat.Services;
using System.Security.Cryptography;

namespace QuantumChat.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext     _db;
    private readonly JwtService       _jwt;
    private readonly HybridPqcService _pqc;
    private readonly IConfiguration   _cfg;

    public AuthController(AppDbContext db, JwtService jwt, HybridPqcService pqc, IConfiguration cfg)
    {
        _db = db; _jwt = jwt; _pqc = pqc; _cfg = cfg;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { error = "Username and password required." });

        if (await _db.Users.AnyAsync(u => u.Username == req.Username))
            return Conflict(new { error = "Username already taken." });

        // Generate ML-KEM-768 key pair
        var (kyberPub, kyberPriv) = _pqc.GenerateKyberKeyPair();

        // Generate ECDH P-256 key pair
        var (ecdhPrivBytes, ecdhPubBytes) = _pqc.GenerateEcdhKeyPair();
        var ecdhPubB64  = Convert.ToBase64String(ecdhPubBytes);
        var ecdhPrivB64 = Convert.ToBase64String(ecdhPrivBytes);

        var kek = GetKek();

        // Encrypt Kyber private key
        var kyberPrivPwd = _pqc.EncryptPrivateKey(kyberPriv, req.Password);
        var kyberPrivKek = _pqc.EncryptPrivateKeyWithKek(kyberPriv, kek);

        // Encrypt ECDH private key (same scheme, re-use methods treating it as raw bytes)
        var ecdhPrivPwd = _pqc.EncryptPrivateKey(ecdhPrivB64, req.Password);
        var ecdhPrivKek = _pqc.EncryptPrivateKeyWithKek(ecdhPrivB64, kek);

        string[] palette = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6"];
        var user = new User
        {
            Username     = req.Username.Trim(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            DisplayName  = req.DisplayName?.Trim() ?? req.Username.Trim(),
            AvatarColor  = palette[Random.Shared.Next(palette.Length)]
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        _db.UserKeyStores.Add(new UserKeyStore
        {
            UserId                         = user.Id,
            KyberPublicKey                 = kyberPub,
            KyberPrivateKeyEncrypted       = kyberPrivPwd,
            KyberPrivateKeyServerEncrypted = kyberPrivKek,
            EcdhPublicKey                  = ecdhPubB64,
            EcdhPrivateKeyEncrypted        = ecdhPrivPwd,
            EcdhPrivateKeyServerEncrypted  = ecdhPrivKek,
        });
        await _db.SaveChangesAsync();

        return Ok(new AuthResponse(
            Token:                    _jwt.GenerateToken(user),
            UserId:                   user.Id,
            Username:                 user.Username,
            DisplayName:              user.DisplayName,
            AvatarColor:              user.AvatarColor,
            KyberPublicKey:           kyberPub,
            EcdhPublicKey:            ecdhPubB64,
            KyberPrivateKeyEncrypted: kyberPrivPwd,
            EcdhPrivateKeyEncrypted:  ecdhPrivPwd
        ));
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == req.Username);
        if (user == null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
            return Unauthorized(new { error = "Invalid username or password." });

        var ks = await _db.UserKeyStores.FirstOrDefaultAsync(k => k.UserId == user.Id);
        if (ks == null) return StatusCode(500, new { error = "Key store missing." });

        return Ok(new AuthResponse(
            Token:                    _jwt.GenerateToken(user),
            UserId:                   user.Id,
            Username:                 user.Username,
            DisplayName:              user.DisplayName,
            AvatarColor:              user.AvatarColor,
            KyberPublicKey:           ks.KyberPublicKey,
            EcdhPublicKey:            ks.EcdhPublicKey,
            KyberPrivateKeyEncrypted: ks.KyberPrivateKeyEncrypted,
            EcdhPrivateKeyEncrypted:  ks.EcdhPrivateKeyEncrypted
        ));
    }

    private byte[] GetKek()
    {
        var kekB64 = _cfg["Kek:MasterKey"];
        if (!string.IsNullOrEmpty(kekB64)) return Convert.FromBase64String(kekB64);
        return RandomNumberGenerator.GetBytes(32);
    }
}
