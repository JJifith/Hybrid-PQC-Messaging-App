using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuantumChat.Crypto;
using QuantumChat.Data;
using System.Security.Claims;

namespace QuantumChat.Controllers;

[ApiController]
[Route("api/crypto")]
[Authorize]
public class DecapsulateController : ControllerBase
{
    private readonly AppDbContext     _db;
    private readonly HybridPqcService _pqc;
    private readonly IConfiguration   _cfg;

    public DecapsulateController(AppDbContext db, HybridPqcService pqc, IConfiguration cfg)
    { _db = db; _pqc = pqc; _cfg = cfg; }

    private int Me => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    /// <summary>
    /// Performs HYBRID decapsulation (ML-KEM-768 + ECDH P-256) server-side using
    /// the authenticated user's KEK-encrypted private keys.
    /// Input KemCiphertext format: "kyberKemB64:ecdhEphemeralPubB64" (optionally "|wrappedKeyB64" appended)
    /// Returns 32-byte combined shared secret.
    /// </summary>
    [HttpPost("decapsulate")]
    public async Task<IActionResult> Decapsulate([FromBody] DecapsulateRequest req)
    {
        var myId = Me;
        var ks   = await _db.UserKeyStores.FirstOrDefaultAsync(k => k.UserId == myId);
        if (ks == null) return NotFound(new { error = "Key store not found." });

        if (string.IsNullOrEmpty(ks.KyberPrivateKeyServerEncrypted) ||
            string.IsNullOrEmpty(ks.EcdhPrivateKeyServerEncrypted))
            return StatusCode(503, new { error = "Server keys not available. Please re-register." });

        try
        {
            var kekB64 = _cfg["Kek:MasterKey"];
            if (string.IsNullOrEmpty(kekB64))
                return StatusCode(500, new { error = "Server KEK not configured." });
            var kek = Convert.FromBase64String(kekB64);

            // Decrypt both private keys using KEK
            var kyberPrivB64  = _pqc.DecryptPrivateKeyWithKek(ks.KyberPrivateKeyServerEncrypted, kek);
            var ecdhPrivB64   = _pqc.DecryptPrivateKeyWithKek(ks.EcdhPrivateKeyServerEncrypted, kek);
            var ecdhPrivBytes = Convert.FromBase64String(ecdhPrivB64);

            // Strip the "|wrappedKeyB64" part if present
            var hybridCt = req.KemCiphertext.Contains('|')
                ? req.KemCiphertext.Split('|')[0]
                : req.KemCiphertext;

            // Hybrid decapsulate → combined 32-byte secret
            var combinedSecret = _pqc.HybridDecapsulate(hybridCt, kyberPrivB64, ecdhPrivBytes);
            return Ok(new { sharedSecretB64 = Convert.ToBase64String(combinedSecret) });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = $"Decapsulation failed: {ex.Message}" });
        }
    }
}

public record DecapsulateRequest(string KemCiphertext);
