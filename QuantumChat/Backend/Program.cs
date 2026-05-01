using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using QuantumChat.Crypto;
using QuantumChat.Data;
using QuantumChat.Hubs;
using QuantumChat.Services;
using QuantumChat.Middleware;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(opts =>
    {
        // Always serialize DateTime as UTC with Z suffix so browsers parse it consistently
        opts.JsonSerializerOptions.Converters.Add(new UtcDateTimeConverter());
    });

builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Default")
        ?? "Data Source=quantumchat.db"));

builder.Services.AddSignalR(o =>
{
    o.MaximumReceiveMessageSize = 12 * 1024 * 1024;
    o.EnableDetailedErrors = builder.Environment.IsDevelopment();
});

builder.Services.AddSingleton<HybridPqcService>();
builder.Services.AddScoped<JwtService>();

var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? "QuantumChat_JWT_Secret_Min32Chars_ChangeInProd!";

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer           = true,
            ValidateAudience         = true,
            ValidateLifetime         = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer              = "QuantumChat",
            ValidAudience            = "QuantumChat",
            IssuerSigningKey         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret))
        };
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hub"))
                    ctx.Token = token;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins("http://localhost:5173", "http://localhost:3000")
     .AllowAnyHeader()
     .AllowAnyMethod()
     .AllowCredentials()
     .WithExposedHeaders("X-Encrypted-IV", "X-Encrypted-Tag", "X-File-Name")));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureCreated();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseStaticFiles();
app.MapControllers();
app.MapHub<ChatHub>("/hub/chat");
app.Run();
