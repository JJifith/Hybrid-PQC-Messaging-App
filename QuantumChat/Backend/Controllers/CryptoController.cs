using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuantumChat.Crypto;
using QuantumChat.Data;
using QuantumChat.DTOs;
using System.Security.Claims;

namespace QuantumChat.Controllers;

[ApiController]
[Route("api/crypto")]
[Authorize]
public class CryptoController : ControllerBase
{
    private readonly AppDbContext     _db;
    private readonly HybridPqcService _pqc;
    private readonly IConfiguration   _cfg;
    private readonly ILogger<CryptoController> _log;

    public CryptoController(AppDbContext db, HybridPqcService pqc, IConfiguration cfg, ILogger<CryptoController> log)
    { _db = db; _pqc = pqc; _cfg = cfg; _log = log; }

    private int Me => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // POST /api/crypto/mitm-demo
    [HttpPost("mitm-demo")]
    public async Task<IActionResult> MitmDemo([FromBody] MitmDemoRequest req)
    {
        var myId = Me;
        var ks   = await _db.UserKeyStores.FirstOrDefaultAsync(k => k.UserId == myId);
        if (ks == null) return BadRequest(new { error = "No key store found." });

        // Pass both public keys for hybrid KEM demo
        var result = _pqc.RunMitmDemo(req.PlaintextMessage, ks.KyberPublicKey, ks.EcdhPublicKey);

        return Ok(new
        {
            kyberAlgo        = result.KyberAlgo,
            ecdhAlgo         = result.EcdhAlgo,
            hybridCombine    = result.HybridCombine,
            kyberCtPreview   = result.KyberCtPreview,
            ecdhEphPubPreview= result.EcdhEphPubPreview,
            aesCiphertext    = result.AesCiphertext,
            gcmIV            = result.GcmIV,
            gcmTag           = result.GcmTag,
            authorizedDecrypt= result.AuthorizedView,
            attackerView     = result.AttackerView,
            securityNote     = result.SecurityNote
        });
    }

    // GET /api/crypto/my-keys
    [HttpGet("my-keys")]
    public async Task<IActionResult> MyKeys()
    {
        var ks = await _db.UserKeyStores.FirstOrDefaultAsync(k => k.UserId == Me);
        if (ks == null) return NotFound();

        var kyberPubBytes = Convert.FromBase64String(ks.KyberPublicKey);
        var ecdhPubBytes  = Convert.FromBase64String(ks.EcdhPublicKey);

        return Ok(new
        {
            hybridKem        = "ML-KEM-768 + ECDH P-256 → HKDF-SHA256(kyberSecret ‖ ecdhSecret)",
            kyberAlgorithm   = "ML-KEM-768 (Kyber-768, NIST FIPS 203 Level 3)",
            kyberPubKeySize  = $"{kyberPubBytes.Length} bytes",
            kyberPubKeyPreview = ks.KyberPublicKey[..48] + "...",
            ecdhAlgorithm    = "ECDH P-256 (classical, NIST curve)",
            ecdhPubKeySize   = $"{ecdhPubBytes.Length} bytes",
            ecdhPubKeyPreview= ks.EcdhPublicKey[..48] + "...",
            symmetric        = "AES-256-GCM",
            keyDerivation    = "HKDF-SHA256 with domain-separated info labels",
            security         = "Must break BOTH ML-KEM-768 AND ECDH P-256 to compromise any key"
        });
    }

    [HttpPost("trace")]
    public IActionResult Trace([FromBody] CryptoTraceRequest req)
    {
        if (!_cfg.GetValue("CryptoTrace:Enabled", true))
            return Ok(new { logged = false });

        var myId = Me;
        var values = req.Values ?? new Dictionary<string, string>();
        var lines = string.Join(Environment.NewLine,
            values.Select(v => $"    {v.Key}: {v.Value}"));

        _log.LogInformation("{Title}{NewLine}    userId: {UserId}{NewLine}{Lines}",
            $"[CryptoTrace] {req.Title}", Environment.NewLine, myId, Environment.NewLine, lines);

        return Ok(new { logged = true });
    }
}
