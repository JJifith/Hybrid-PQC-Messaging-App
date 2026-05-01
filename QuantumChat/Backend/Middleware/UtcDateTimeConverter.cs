using System.Text.Json;
using System.Text.Json.Serialization;

namespace QuantumChat.Middleware;

/// <summary>
/// Ensures all DateTime values are serialized as UTC ISO-8601 with Z suffix.
/// Prevents the time-zone display bug where different browsers show different times.
/// </summary>
public class UtcDateTimeConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var str = reader.GetString()!;
        var dt  = DateTime.Parse(str, null, System.Globalization.DateTimeStyles.AdjustToUniversal);
        return DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        var utc = value.Kind == DateTimeKind.Utc ? value : value.ToUniversalTime();
        // Include milliseconds for consistency with JavaScript's toISOString()
        writer.WriteStringValue(utc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
    }
}
