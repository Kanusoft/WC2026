using Microsoft.Data.Sqlite;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddEndpointsApiExplorer();
var app = builder.Build();

var dataDir = Path.Combine(app.Environment.ContentRootPath, "App_Data");
Directory.CreateDirectory(dataDir);
var dbPath = Path.Combine(dataDir, "worldcup2026pool.db");
var connectionString = $"Data Source={dbPath}";
Db.Init(connectionString);

var predictionLockUtc = DateTimeOffset.Parse(
    "2026-06-10T19:00:00Z",
    CultureInfo.InvariantCulture,
    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);

var ninosEditOverrideDatePacific = new DateOnly(2026, 6, 21);
TimeZoneInfo pacificTimeZone;
try
{
    pacificTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Pacific Standard Time");
}
catch (TimeZoneNotFoundException)
{
    pacificTimeZone = TimeZoneInfo.FindSystemTimeZoneById("America/Los_Angeles");
}

var scheduleOpenUtc = DateTimeOffset.Parse(
    "2026-06-11T00:00:00Z",
    CultureInfo.InvariantCulture,
    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);

app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? string.Empty;
    var isScheduleRoute = path.Equals("/schedule.html", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/predictions/schedule", StringComparison.OrdinalIgnoreCase);

    if (isScheduleRoute && DateTimeOffset.UtcNow < scheduleOpenUtc)
    {
        if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(new { Message = "Schedule is not available until kickoff day." });
            return;
        }

        context.Response.Redirect("/");
        return;
    }

    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapPost("/api/login", async (LoginRequest req) =>
{
    var user = await Db.GetUserByName(connectionString, req.Name.Trim());
    if (user is null || user.PinHash != Db.HashPin(req.Pin)) return Results.Unauthorized();
    return Results.Ok(new { user.Id, user.Name, user.IsAdmin });
});

app.MapGet("/api/matches", async () => Results.Ok(await Db.GetMatches(connectionString)));

app.MapGet("/api/predictions/{userId:int}", async (int userId) => Results.Ok(await Db.GetPredictions(connectionString, userId)));

app.MapGet("/api/predictions/today", async () => Results.Ok(await Db.GetTodayMatchesWithPredictions(connectionString)));

app.MapGet("/api/predictions/schedule", async () => Results.Ok(await Db.GetScheduleMatchesWithPredictions(connectionString)));

app.MapGet("/api/round32/matches", async () => Results.Ok(await Db.GetRound32Matches(connectionString)));

app.MapGet("/api/round32/predictions/{userId:int}", async (int userId) => Results.Ok(await Db.GetRound32Predictions(connectionString, userId)));

app.MapPost("/api/round32/predictions", async (PredictionSave req) =>
{
    await Db.SaveRound32Prediction(connectionString, req.UserId, req.MatchId, req.HomeGoals, req.AwayGoals);
    return Results.Ok();
});

app.MapGet("/api/round32/leaderboard", async () => Results.Ok(await Db.GetRound32Leaderboard(connectionString)));

bool IsNinosOverrideActive(User? user, DateTimeOffset nowUtc)
{
    if (user is null) return false;
    if (!user.Name.Equals("Ninos", StringComparison.OrdinalIgnoreCase)) return false;
    var pacificNow = TimeZoneInfo.ConvertTime(nowUtc, pacificTimeZone);
    return DateOnly.FromDateTime(pacificNow.DateTime) == ninosEditOverrideDatePacific;
}

bool IsPredictionLockedFor(User? user, DateTimeOffset nowUtc)
{
    if (nowUtc < predictionLockUtc) return false;
    return !IsNinosOverrideActive(user, nowUtc);
}

app.MapGet("/api/predictions/status", async (int? userId) =>
{
    User? user = null;
    if (userId.HasValue)
    {
        user = await Db.GetUserById(connectionString, userId.Value);
    }

    var nowUtc = DateTimeOffset.UtcNow;
    var overrideActive = IsNinosOverrideActive(user, nowUtc);
    return Results.Ok(new
    {
    IsLocked = IsPredictionLockedFor(user, nowUtc),
    LockAtUtc = predictionLockUtc.ToString("O"),
    IsNinosOverrideActive = overrideActive,
    IsScheduleOpen = DateTimeOffset.UtcNow >= scheduleOpenUtc,
    ScheduleOpenAtUtc = scheduleOpenUtc.ToString("O")
    });
});

app.MapPost("/api/predictions", async (PredictionSave req) =>
{
    var user = await Db.GetUserById(connectionString, req.UserId);
    if (user is null) return Results.Unauthorized();

    if (IsPredictionLockedFor(user, DateTimeOffset.UtcNow))
    {
        return Results.Json(new
        {
            Message = "Predictions are locked one day before kickoff."
        }, statusCode: StatusCodes.Status403Forbidden);
    }

    await Db.SavePrediction(connectionString, req.UserId, req.MatchId, req.HomeGoals, req.AwayGoals);
    return Results.Ok();
});

app.MapPost("/api/admin/matches", async (MatchUpdate req) =>
{
    if (!await Db.IsAdmin(connectionString, req.AdminUserId)) return Results.Unauthorized();
    await Db.UpdateMatch(connectionString, req);
    return Results.Ok();
});

app.MapPost("/api/admin/result", async (ResultUpdate req) =>
{
    if (!await Db.IsAdmin(connectionString, req.AdminUserId)) return Results.Unauthorized();
    await Db.UpdateResult(connectionString, req);
    return Results.Ok();
});

app.MapGet("/api/leaderboard", async () => Results.Ok(await Db.GetLeaderboard(connectionString)));

app.MapGet("/api/export/{userId:int}", async (int userId) =>
{
    var user = await Db.GetUserById(connectionString, userId);
    if (user is null) return Results.NotFound();

    var csv = await Db.ExportPredictionsCsv(connectionString, userId, user.Name);
    var fileName = $"{Db.ToSafeFilePart(user.Name)}_predictions_{DateTime.UtcNow:yyyy-MM-dd}.csv";
    return Results.File(Encoding.UTF8.GetBytes(csv), "text/csv; charset=utf-8", fileName);
});

app.Run();

record LoginRequest(string Name, string Pin);
record PredictionSave(int UserId, int MatchId, int? HomeGoals, int? AwayGoals);
record MatchUpdate(int AdminUserId, int MatchId, string GroupName, string HomeTeam, string AwayTeam, string? KickoffUtc, string? Venue);
record ResultUpdate(int AdminUserId, int MatchId, int? ActualHomeGoals, int? ActualAwayGoals);
record Round32Match(int Id, string HomeTeam, string AwayTeam, string KickoffUtc, string? Venue, string? Location, int? ActualHomeGoals, int? ActualAwayGoals);
record TodayPrediction(int UserId, string UserName, int? HomeGoals, int? AwayGoals);
record TodayMatch(int Id, string GroupName, string HomeTeam, string AwayTeam, string KickoffUtc, string? Venue, int? ActualHomeGoals, int? ActualAwayGoals, List<TodayPrediction> Predictions);
record User(int Id, string Name, string PinHash, bool IsAdmin);

static class Db
{
    public static string HashPin(string pin)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(pin.Trim()));
        return Convert.ToHexString(bytes);
    }

    public static void Init(string cs)
    {
        using var con = new SqliteConnection(cs);
        con.Open();
        Exec(con, @"
CREATE TABLE IF NOT EXISTS Users(
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Name TEXT NOT NULL UNIQUE,
  PinHash TEXT NOT NULL,
  IsAdmin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS Matches(
  Id INTEGER PRIMARY KEY,
  GroupName TEXT NOT NULL,
  HomeTeam TEXT NOT NULL,
  AwayTeam TEXT NOT NULL,
  KickoffUtc TEXT NULL,
  Venue TEXT NULL,
  ActualHomeGoals INTEGER NULL,
  ActualAwayGoals INTEGER NULL
);
CREATE TABLE IF NOT EXISTS Predictions(
  UserId INTEGER NOT NULL,
  MatchId INTEGER NOT NULL,
  HomeGoals INTEGER NULL,
  AwayGoals INTEGER NULL,
  UpdatedAtUtc TEXT NOT NULL,
  PRIMARY KEY(UserId, MatchId)
);
CREATE TABLE IF NOT EXISTS Round32Matches(
    Id INTEGER PRIMARY KEY,
    HomeTeam TEXT NOT NULL,
    AwayTeam TEXT NOT NULL,
    KickoffUtc TEXT NOT NULL,
    Venue TEXT NULL,
    Location TEXT NULL,
    ActualHomeGoals INTEGER NULL,
    ActualAwayGoals INTEGER NULL
);
CREATE TABLE IF NOT EXISTS Round32Predictions(
    UserId INTEGER NOT NULL,
    MatchId INTEGER NOT NULL,
    HomeGoals INTEGER NULL,
    AwayGoals INTEGER NULL,
    UpdatedAtUtc TEXT NOT NULL,
    PRIMARY KEY(UserId, MatchId)
);");

        var count = ScalarLong(con, "SELECT COUNT(*) FROM Users");
        if (count == 0)
        {
            AddUser(con, "Elie", "3102", false);
            AddUser(con, "Ninos", "2125", false);
            AddUser(con, "Jacob", "1150", false);
            AddUser(con, "Zuhir", "9010", false);
            AddUser(con, "Akkad", "9999", true);
        }
        var matchCount = ScalarLong(con, "SELECT COUNT(*) FROM Matches");
        if (matchCount == 0)
        {
            SeedMatches(con);
        }
        else if (HasPlaceholderMatches(con))
        {
            Exec(con, "DELETE FROM Predictions;");
            Exec(con, "DELETE FROM Matches;");
            SeedMatches(con);
        }

        var round32Count = ScalarLong(con, "SELECT COUNT(*) FROM Round32Matches");
        if (round32Count == 0)
        {
            SeedRound32Matches(con);
        }

        EnsureCriticalKickoffs(con);
    }

    static void EnsureCriticalKickoffs(SqliteConnection con)
    {
        // Keep existing data intact and only patch known missing kickoff values.
        using var cmd = con.CreateCommand();
        cmd.CommandText = "UPDATE Matches SET KickoffUtc=$k WHERE Id=1 AND (KickoffUtc IS NULL OR trim(KickoffUtc)='')";
        cmd.Parameters.AddWithValue("$k", ToUtcIsoFromEt("2026-06-11", "15:00"));
        cmd.ExecuteNonQuery();
    }

    static void AddUser(SqliteConnection con, string name, string pin, bool admin)
    {
        using var cmd = con.CreateCommand();
        cmd.CommandText = "INSERT INTO Users(Name, PinHash, IsAdmin) VALUES($n,$p,$a)";
        cmd.Parameters.AddWithValue("$n", name);
        cmd.Parameters.AddWithValue("$p", HashPin(pin));
        cmd.Parameters.AddWithValue("$a", admin ? 1 : 0);
        cmd.ExecuteNonQuery();
    }

    static void SeedMatches(SqliteConnection con)
    {
        var fixtures = new (string Group, string Home, string Away, string Date, string EtTime, string Venue)[]
        {
            ("A", "Mexico", "South Africa", "2026-06-11", "15:00", "Estadio Azteca (Mexico City)"),
            ("A", "South Korea", "Czechia", "2026-06-11", "22:00", "Estadio Akron (Guadalajara)"),
            ("B", "Canada", "Bosnia and Herzegovina", "2026-06-12", "15:00", "BMO Field (Toronto)"),
            ("D", "USA", "Paraguay", "2026-06-12", "21:00", "SoFi Stadium (Los Angeles)"),
            ("C", "Haiti", "Scotland", "2026-06-13", "21:00", "Gillette Stadium (Boston)"),
            ("D", "Australia", "Turkiye", "2026-06-13", "00:00", "BC Place (Vancouver)"),
            ("C", "Brazil", "Morocco", "2026-06-13", "18:00", "MetLife Stadium (New York/New Jersey)"),
            ("B", "Qatar", "Switzerland", "2026-06-13", "15:00", "Levi's Stadium (San Francisco Bay Area)"),
            ("E", "Cote d'Ivoire", "Ecuador", "2026-06-14", "19:00", "Lincoln Financial Field (Philadelphia)"),
            ("E", "Germany", "Curacao", "2026-06-14", "13:00", "NRG Stadium (Houston)"),
            ("F", "Netherlands", "Japan", "2026-06-14", "16:00", "AT&T Stadium (Dallas)"),
            ("F", "Sweden", "Tunisia", "2026-06-14", "22:00", "Estadio BBVA (Monterrey)"),
            ("H", "Saudi Arabia", "Uruguay", "2026-06-15", "18:00", "Hard Rock Stadium (Miami)"),
            ("H", "Spain", "Cabo Verde", "2026-06-15", "12:00", "Mercedes-Benz Stadium (Atlanta)"),
            ("G", "Iran", "New Zealand", "2026-06-15", "21:00", "SoFi Stadium (Los Angeles)"),
            ("G", "Belgium", "Egypt", "2026-06-15", "15:00", "Lumen Field (Seattle)"),
            ("I", "France", "Senegal", "2026-06-16", "15:00", "MetLife Stadium (New York/New Jersey)"),
            ("I", "Iraq", "Norway", "2026-06-16", "18:00", "Gillette Stadium (Boston)"),
            ("J", "Argentina", "Algeria", "2026-06-16", "21:00", "Arrowhead Stadium (Kansas City)"),
            ("J", "Austria", "Jordan", "2026-06-16", "00:00", "Levi's Stadium (San Francisco Bay Area)"),
            ("L", "Ghana", "Panama", "2026-06-17", "19:00", "BMO Field (Toronto)"),
            ("L", "England", "Croatia", "2026-06-17", "16:00", "AT&T Stadium (Dallas)"),
            ("K", "Portugal", "Congo DR", "2026-06-17", "13:00", "NRG Stadium (Houston)"),
            ("K", "Uzbekistan", "Colombia", "2026-06-17", "22:00", "Estadio Azteca (Mexico City)"),
            ("A", "Czechia", "South Africa", "2026-06-18", "12:00", "Mercedes-Benz Stadium (Atlanta)"),
            ("B", "Switzerland", "Bosnia and Herzegovina", "2026-06-18", "15:00", "SoFi Stadium (Los Angeles)"),
            ("B", "Canada", "Qatar", "2026-06-18", "18:00", "BC Place (Vancouver)"),
            ("A", "Mexico", "South Korea", "2026-06-18", "21:00", "Estadio Akron (Guadalajara)"),
            ("C", "Brazil", "Haiti", "2026-06-19", "21:00", "Lincoln Financial Field (Philadelphia)"),
            ("C", "Scotland", "Morocco", "2026-06-19", "18:00", "Gillette Stadium (Boston)"),
            ("D", "Turkiye", "Paraguay", "2026-06-19", "23:00", "Levi's Stadium (San Francisco Bay Area)"),
            ("D", "USA", "Australia", "2026-06-19", "15:00", "Lumen Field (Seattle)"),
            ("E", "Germany", "Cote d'Ivoire", "2026-06-20", "16:00", "BMO Field (Toronto)"),
            ("E", "Ecuador", "Curacao", "2026-06-20", "20:00", "Arrowhead Stadium (Kansas City)"),
            ("F", "Netherlands", "Sweden", "2026-06-20", "13:00", "NRG Stadium (Houston)"),
            ("F", "Tunisia", "Japan", "2026-06-20", "00:00", "Estadio BBVA (Monterrey)"),
            ("H", "Uruguay", "Cabo Verde", "2026-06-21", "18:00", "Hard Rock Stadium (Miami)"),
            ("H", "Spain", "Saudi Arabia", "2026-06-21", "12:00", "Mercedes-Benz Stadium (Atlanta)"),
            ("G", "Belgium", "Iran", "2026-06-21", "15:00", "SoFi Stadium (Los Angeles)"),
            ("G", "New Zealand", "Egypt", "2026-06-21", "21:00", "BC Place (Vancouver)"),
            ("I", "Norway", "Senegal", "2026-06-22", "20:00", "MetLife Stadium (New York/New Jersey)"),
            ("I", "France", "Iraq", "2026-06-22", "17:00", "Lincoln Financial Field (Philadelphia)"),
            ("J", "Argentina", "Austria", "2026-06-22", "13:00", "AT&T Stadium (Dallas)"),
            ("J", "Jordan", "Algeria", "2026-06-22", "23:00", "Levi's Stadium (San Francisco Bay Area)"),
            ("L", "England", "Ghana", "2026-06-23", "16:00", "Gillette Stadium (Boston)"),
            ("L", "Panama", "Croatia", "2026-06-23", "19:00", "BMO Field (Toronto)"),
            ("K", "Portugal", "Uzbekistan", "2026-06-23", "13:00", "NRG Stadium (Houston)"),
            ("K", "Colombia", "Congo DR", "2026-06-23", "22:00", "Estadio Akron (Guadalajara)"),
            ("C", "Scotland", "Brazil", "2026-06-24", "18:00", "Hard Rock Stadium (Miami)"),
            ("C", "Morocco", "Haiti", "2026-06-24", "18:00", "Mercedes-Benz Stadium (Atlanta)"),
            ("B", "Switzerland", "Canada", "2026-06-24", "15:00", "BC Place (Vancouver)"),
            ("B", "Bosnia and Herzegovina", "Qatar", "2026-06-24", "15:00", "Lumen Field (Seattle)"),
            ("A", "Czechia", "Mexico", "2026-06-24", "21:00", "Estadio Azteca (Mexico City)"),
            ("A", "South Africa", "South Korea", "2026-06-24", "21:00", "Estadio BBVA (Monterrey)"),
            ("E", "Curacao", "Cote d'Ivoire", "2026-06-25", "16:00", "Lincoln Financial Field (Philadelphia)"),
            ("E", "Ecuador", "Germany", "2026-06-25", "16:00", "MetLife Stadium (New York/New Jersey)"),
            ("F", "Japan", "Sweden", "2026-06-25", "19:00", "AT&T Stadium (Dallas)"),
            ("F", "Tunisia", "Netherlands", "2026-06-25", "19:00", "Arrowhead Stadium (Kansas City)"),
            ("D", "Turkiye", "USA", "2026-06-25", "22:00", "SoFi Stadium (Los Angeles)"),
            ("D", "Paraguay", "Australia", "2026-06-25", "22:00", "Levi's Stadium (San Francisco Bay Area)"),
            ("I", "Norway", "France", "2026-06-26", "15:00", "Gillette Stadium (Boston)"),
            ("I", "Senegal", "Iraq", "2026-06-26", "15:00", "BMO Field (Toronto)"),
            ("G", "Egypt", "Iran", "2026-06-26", "23:00", "Lumen Field (Seattle)"),
            ("G", "New Zealand", "Belgium", "2026-06-26", "23:00", "BC Place (Vancouver)"),
            ("H", "Cabo Verde", "Saudi Arabia", "2026-06-26", "20:00", "NRG Stadium (Houston)"),
            ("H", "Uruguay", "Spain", "2026-06-26", "20:00", "Estadio Akron (Guadalajara)"),
            ("L", "Panama", "England", "2026-06-27", "17:00", "MetLife Stadium (New York/New Jersey)"),
            ("L", "Croatia", "Ghana", "2026-06-27", "17:00", "Lincoln Financial Field (Philadelphia)"),
            ("J", "Algeria", "Austria", "2026-06-27", "22:00", "Arrowhead Stadium (Kansas City)"),
            ("J", "Jordan", "Argentina", "2026-06-27", "22:00", "AT&T Stadium (Dallas)"),
            ("K", "Colombia", "Portugal", "2026-06-27", "19:30", "Hard Rock Stadium (Miami)"),
            ("K", "Congo DR", "Uzbekistan", "2026-06-27", "19:30", "Mercedes-Benz Stadium (Atlanta)")
        };

        var id = 1;
        foreach (var f in fixtures)
        {
            using var cmd = con.CreateCommand();
            cmd.CommandText = "INSERT INTO Matches(Id, GroupName, HomeTeam, AwayTeam, KickoffUtc, Venue) VALUES($id,$g,$h,$a,$k,$v)";
            cmd.Parameters.AddWithValue("$id", id++);
            cmd.Parameters.AddWithValue("$g", f.Group);
            cmd.Parameters.AddWithValue("$h", f.Home);
            cmd.Parameters.AddWithValue("$a", f.Away);
            cmd.Parameters.AddWithValue("$k", ToUtcIsoFromEt(f.Date, f.EtTime));
            cmd.Parameters.AddWithValue("$v", f.Venue);
            cmd.ExecuteNonQuery();
        }
    }

    static bool HasPlaceholderMatches(SqliteConnection con)
    {
        return ScalarLong(con, "SELECT COUNT(*) FROM Matches WHERE HomeTeam LIKE 'Group % Team %' OR AwayTeam LIKE 'Group % Team %'") > 0;
    }

    static void SeedRound32Matches(SqliteConnection con)
    {
        var fixtures = new (string Home, string Away, string Date, string LocalTime, string Venue, string Location, string TimeZoneId)[]
        {
            ("South Africa", "Canada", "2026-06-28", "12:00 PM", "SoFi Stadium", "Los Angeles, CA", "Pacific Standard Time"),
            ("Brazil", "Japan", "2026-06-29", "12:00 PM", "Houston Stadium", "Houston, TX", "Central Standard Time"),
            ("Germany", "Paraguay", "2026-06-29", "4:30 PM", "Boston Stadium", "Boston, MA", "Eastern Standard Time"),
            ("Netherlands", "Morocco", "2026-06-29", "9:00 PM", "Estadio Monterrey", "Monterrey, Mexico", "Central Standard Time (Mexico)"),
            ("Cote d'Ivoire", "Norway", "2026-06-30", "12:00 PM", "Dallas Stadium", "Dallas, TX", "Central Standard Time"),
            ("France", "Sweden", "2026-06-30", "5:00 PM", "NY/NJ Stadium", "East Rutherford, NJ", "Eastern Standard Time"),
            ("Mexico", "Ecuador", "2026-06-30", "9:00 PM", "Mexico City Stadium", "Mexico City, Mexico", "Central Standard Time (Mexico)"),
            ("England", "Congo DR", "2026-07-01", "12:00 PM", "Atlanta Stadium", "Atlanta, GA", "Eastern Standard Time"),
            ("Belgium", "Senegal", "2026-07-01", "4:00 PM", "Seattle Stadium", "Seattle, WA", "Pacific Standard Time"),
            ("USA", "Bosnia and Herzegovina", "2026-07-01", "7:00 PM", "San Francisco Bay Area Stadium", "Santa Clara, CA", "Pacific Standard Time"),
            ("Spain", "Austria", "2026-07-02", "12:00 PM", "SoFi Stadium", "Los Angeles, CA", "Pacific Standard Time"),
            ("Portugal", "Croatia", "2026-07-02", "7:00 PM", "Toronto Stadium", "Toronto, Canada", "Eastern Standard Time"),
            ("Switzerland", "Algeria", "2026-07-02", "8:00 PM", "BC Place Vancouver", "Vancouver, Canada", "Pacific Standard Time"),
            ("Australia", "Egypt", "2026-07-03", "2:00 PM", "Dallas Stadium", "Dallas, TX", "Central Standard Time"),
            ("Argentina", "Cabo Verde", "2026-07-03", "6:00 PM", "Miami Stadium", "Miami, FL", "Eastern Standard Time"),
            ("Colombia", "Ghana", "2026-07-03", "9:30 PM", "Kansas City Stadium", "Kansas City, MO", "Central Standard Time")
        };

        var id = 1;
        foreach (var f in fixtures)
        {
            using var cmd = con.CreateCommand();
            cmd.CommandText = @"INSERT INTO Round32Matches(Id, HomeTeam, AwayTeam, KickoffUtc, Venue, Location)
VALUES($id,$h,$a,$k,$v,$l)";
            cmd.Parameters.AddWithValue("$id", id++);
            cmd.Parameters.AddWithValue("$h", f.Home);
            cmd.Parameters.AddWithValue("$a", f.Away);
            cmd.Parameters.AddWithValue("$k", ToUtcIsoFromLocalTime(f.Date, f.LocalTime, f.TimeZoneId));
            cmd.Parameters.AddWithValue("$v", f.Venue);
            cmd.Parameters.AddWithValue("$l", f.Location);
            cmd.ExecuteNonQuery();
        }
    }

    static string ToUtcIsoFromEt(string date, string etTime)
    {
        var local = DateTime.ParseExact($"{date} {etTime}", "yyyy-MM-dd HH:mm", null);
        TimeZoneInfo eastern;
        try
        {
            eastern = TimeZoneInfo.FindSystemTimeZoneById("Eastern Standard Time");
        }
        catch (TimeZoneNotFoundException)
        {
            eastern = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        }
        var utc = TimeZoneInfo.ConvertTimeToUtc(local, eastern);
        return utc.ToString("O");
    }

    static string ToUtcIsoFromLocalTime(string date, string localTime, string timeZoneId)
    {
        var local = DateTime.ParseExact($"{date} {localTime}", "yyyy-MM-dd h:mm tt", CultureInfo.InvariantCulture);
        var tz = ResolveTimeZone(timeZoneId);
        var utc = TimeZoneInfo.ConvertTimeToUtc(local, tz);
        return utc.ToString("O");
    }

    static TimeZoneInfo ResolveTimeZone(string id)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (TimeZoneNotFoundException)
        {
            return id switch
            {
                "Pacific Standard Time" => TimeZoneInfo.FindSystemTimeZoneById("America/Los_Angeles"),
                "Central Standard Time" => TimeZoneInfo.FindSystemTimeZoneById("America/Chicago"),
                "Eastern Standard Time" => TimeZoneInfo.FindSystemTimeZoneById("America/New_York"),
                "Central Standard Time (Mexico)" => TimeZoneInfo.FindSystemTimeZoneById("America/Mexico_City"),
                _ => TimeZoneInfo.Utc
            };
        }
    }

    public static async Task<User?> GetUserByName(string cs, string name)
    {
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT Id, Name, PinHash, IsAdmin FROM Users WHERE lower(Name)=lower($n)";
        cmd.Parameters.AddWithValue("$n", name);
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? new User(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetInt32(3) == 1) : null;
    }

    public static async Task<bool> IsAdmin(string cs, int userId)
    {
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT IsAdmin FROM Users WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", userId);
        var result = await cmd.ExecuteScalarAsync();
        return result is long l && l == 1;
    }

    public static async Task<User?> GetUserById(string cs, int userId)
    {
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT Id, Name, PinHash, IsAdmin FROM Users WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", userId);
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? new User(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetInt32(3) == 1) : null;
    }

    public static async Task<List<object>> GetMatches(string cs)
    {
        var list = new List<object>();
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT Id, GroupName, HomeTeam, AwayTeam, KickoffUtc, Venue, ActualHomeGoals, ActualAwayGoals FROM Matches ORDER BY Id";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) list.Add(new {
            Id=r.GetInt32(0), GroupName=r.GetString(1), HomeTeam=r.GetString(2), AwayTeam=r.GetString(3),
            KickoffUtc=r.IsDBNull(4)?null:r.GetString(4), Venue=r.IsDBNull(5)?null:r.GetString(5),
            ActualHomeGoals=r.IsDBNull(6)?(int?)null:r.GetInt32(6), ActualAwayGoals=r.IsDBNull(7)?(int?)null:r.GetInt32(7)
        });
        return list;
    }

    public static async Task<Dictionary<int, object>> GetPredictions(string cs, int userId)
    {
        var d = new Dictionary<int, object>();
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT MatchId, HomeGoals, AwayGoals FROM Predictions WHERE UserId=$u";
        cmd.Parameters.AddWithValue("$u", userId);
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) d[r.GetInt32(0)] = new { HomeGoals = r.IsDBNull(1)?(int?)null:r.GetInt32(1), AwayGoals = r.IsDBNull(2)?(int?)null:r.GetInt32(2) };
        return d;
    }

    public static async Task<List<object>> GetRound32Matches(string cs)
    {
        var list = new List<object>();
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT Id, HomeTeam, AwayTeam, KickoffUtc, Venue, Location, ActualHomeGoals, ActualAwayGoals FROM Round32Matches ORDER BY KickoffUtc, Id";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) list.Add(new {
            Id=r.GetInt32(0), HomeTeam=r.GetString(1), AwayTeam=r.GetString(2), KickoffUtc=r.GetString(3),
            Venue=r.IsDBNull(4)?null:r.GetString(4), Location=r.IsDBNull(5)?null:r.GetString(5),
            ActualHomeGoals=r.IsDBNull(6)?(int?)null:r.GetInt32(6), ActualAwayGoals=r.IsDBNull(7)?(int?)null:r.GetInt32(7)
        });
        return list;
    }

    public static async Task<Dictionary<int, object>> GetRound32Predictions(string cs, int userId)
    {
        var d = new Dictionary<int, object>();
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT MatchId, HomeGoals, AwayGoals FROM Round32Predictions WHERE UserId=$u";
        cmd.Parameters.AddWithValue("$u", userId);
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) d[r.GetInt32(0)] = new { HomeGoals = r.IsDBNull(1)?(int?)null:r.GetInt32(1), AwayGoals = r.IsDBNull(2)?(int?)null:r.GetInt32(2) };
        return d;
    }

    public static async Task<List<TodayMatch>> GetTodayMatchesWithPredictions(string cs)
    {
        var matchOrder = new List<int>();
        var matchMeta = new Dictionary<int, (string GroupName, string HomeTeam, string AwayTeam, string KickoffUtc, string? Venue, int? ActualHomeGoals, int? ActualAwayGoals)>();
        var matchPredictions = new Dictionary<int, List<TodayPrediction>>();

        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = @"
SELECT
  m.Id,
  m.GroupName,
  m.HomeTeam,
  m.AwayTeam,
  m.KickoffUtc,
  m.Venue,
  m.ActualHomeGoals,
  m.ActualAwayGoals,
  u.Id,
  u.Name,
  p.HomeGoals,
  p.AwayGoals
FROM Matches m
CROSS JOIN Users u
LEFT JOIN Predictions p ON p.MatchId = m.Id AND p.UserId = u.Id
WHERE m.KickoffUtc IS NOT NULL AND date(m.KickoffUtc) = date('now')
ORDER BY m.KickoffUtc, m.Id, u.Name;";

        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var matchId = r.GetInt32(0);
            if (!matchMeta.ContainsKey(matchId))
            {
                matchOrder.Add(matchId);
                matchMeta[matchId] = (
                    r.GetString(1),
                    r.GetString(2),
                    r.GetString(3),
                    r.GetString(4),
                    r.IsDBNull(5) ? null : r.GetString(5),
                    r.IsDBNull(6) ? (int?)null : r.GetInt32(6),
                    r.IsDBNull(7) ? (int?)null : r.GetInt32(7));
                matchPredictions[matchId] = new List<TodayPrediction>();
            }

            matchPredictions[matchId].Add(new TodayPrediction(
                r.GetInt32(8),
                r.GetString(9),
                r.IsDBNull(10) ? (int?)null : r.GetInt32(10),
                r.IsDBNull(11) ? (int?)null : r.GetInt32(11)));
        }

        var result = new List<TodayMatch>();
        foreach (var matchId in matchOrder)
        {
            var meta = matchMeta[matchId];
            result.Add(new TodayMatch(
                matchId,
                meta.GroupName,
                meta.HomeTeam,
                meta.AwayTeam,
                meta.KickoffUtc,
                meta.Venue,
                meta.ActualHomeGoals,
                meta.ActualAwayGoals,
                matchPredictions[matchId]));
        }

        return result;
    }

    public static async Task<List<TodayMatch>> GetScheduleMatchesWithPredictions(string cs)
    {
        var matchOrder = new List<int>();
        var matchMeta = new Dictionary<int, (string GroupName, string HomeTeam, string AwayTeam, string KickoffUtc, string? Venue, int? ActualHomeGoals, int? ActualAwayGoals)>();
        var matchPredictions = new Dictionary<int, List<TodayPrediction>>();

        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = @"
SELECT
  m.Id,
  m.GroupName,
  m.HomeTeam,
  m.AwayTeam,
  m.KickoffUtc,
  m.Venue,
  m.ActualHomeGoals,
  m.ActualAwayGoals,
  u.Id,
  u.Name,
  p.HomeGoals,
  p.AwayGoals
FROM Matches m
CROSS JOIN Users u
LEFT JOIN Predictions p ON p.MatchId = m.Id AND p.UserId = u.Id
ORDER BY m.Id, u.Name;";

        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var matchId = r.GetInt32(0);
            if (!matchMeta.ContainsKey(matchId))
            {
                matchOrder.Add(matchId);
                matchMeta[matchId] = (
                    r.GetString(1),
                    r.GetString(2),
                    r.GetString(3),
                    r.IsDBNull(4) ? "" : r.GetString(4),
                    r.IsDBNull(5) ? null : r.GetString(5),
                    r.IsDBNull(6) ? (int?)null : r.GetInt32(6),
                    r.IsDBNull(7) ? (int?)null : r.GetInt32(7));
                matchPredictions[matchId] = new List<TodayPrediction>();
            }

            matchPredictions[matchId].Add(new TodayPrediction(
                r.GetInt32(8),
                r.GetString(9),
                r.IsDBNull(10) ? (int?)null : r.GetInt32(10),
                r.IsDBNull(11) ? (int?)null : r.GetInt32(11)));
        }

        var result = new List<TodayMatch>();
        foreach (var matchId in matchOrder)
        {
            var meta = matchMeta[matchId];
            result.Add(new TodayMatch(
                matchId,
                meta.GroupName,
                meta.HomeTeam,
                meta.AwayTeam,
                meta.KickoffUtc,
                meta.Venue,
                meta.ActualHomeGoals,
                meta.ActualAwayGoals,
                matchPredictions[matchId]));
        }

        return result;
    }

    public static async Task SavePrediction(string cs, int userId, int matchId, int? hg, int? ag)
    {
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = @"INSERT INTO Predictions(UserId, MatchId, HomeGoals, AwayGoals, UpdatedAtUtc)
VALUES($u,$m,$h,$a,$t)
ON CONFLICT(UserId,MatchId) DO UPDATE SET HomeGoals=$h, AwayGoals=$a, UpdatedAtUtc=$t";
        cmd.Parameters.AddWithValue("$u", userId); cmd.Parameters.AddWithValue("$m", matchId);
        cmd.Parameters.AddWithValue("$h", (object?)hg ?? DBNull.Value); cmd.Parameters.AddWithValue("$a", (object?)ag ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$t", DateTime.UtcNow.ToString("O")); await cmd.ExecuteNonQueryAsync();
    }

    public static async Task SaveRound32Prediction(string cs, int userId, int matchId, int? hg, int? ag)
    {
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = @"INSERT INTO Round32Predictions(UserId, MatchId, HomeGoals, AwayGoals, UpdatedAtUtc)
VALUES($u,$m,$h,$a,$t)
ON CONFLICT(UserId,MatchId) DO UPDATE SET HomeGoals=$h, AwayGoals=$a, UpdatedAtUtc=$t";
        cmd.Parameters.AddWithValue("$u", userId); cmd.Parameters.AddWithValue("$m", matchId);
        cmd.Parameters.AddWithValue("$h", (object?)hg ?? DBNull.Value); cmd.Parameters.AddWithValue("$a", (object?)ag ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$t", DateTime.UtcNow.ToString("O")); await cmd.ExecuteNonQueryAsync();
    }

    public static async Task UpdateMatch(string cs, MatchUpdate m)
    {
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = "UPDATE Matches SET GroupName=$g, HomeTeam=$h, AwayTeam=$a, KickoffUtc=$k, Venue=$v WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", m.MatchId); cmd.Parameters.AddWithValue("$g", m.GroupName); cmd.Parameters.AddWithValue("$h", m.HomeTeam); cmd.Parameters.AddWithValue("$a", m.AwayTeam);
        cmd.Parameters.AddWithValue("$k", (object?)m.KickoffUtc ?? DBNull.Value); cmd.Parameters.AddWithValue("$v", (object?)m.Venue ?? DBNull.Value); await cmd.ExecuteNonQueryAsync();
    }

    public static async Task UpdateResult(string cs, ResultUpdate m)
    {
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = "UPDATE Matches SET ActualHomeGoals=$h, ActualAwayGoals=$a WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", m.MatchId); cmd.Parameters.AddWithValue("$h", (object?)m.ActualHomeGoals ?? DBNull.Value); cmd.Parameters.AddWithValue("$a", (object?)m.ActualAwayGoals ?? DBNull.Value); await cmd.ExecuteNonQueryAsync();
    }

    public static async Task<List<object>> GetLeaderboard(string cs)
    {
        var users = new List<(int Id, string Name)>();
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using (var cmd = con.CreateCommand())
        {
            cmd.CommandText = "SELECT Id, Name FROM Users ORDER BY Id";
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync()) users.Add((r.GetInt32(0), r.GetString(1)));
        }
        var board = new List<object>();
        foreach (var u in users)
        {
            await using var cmd = con.CreateCommand();
            cmd.CommandText = @"
SELECT COUNT(p.MatchId), COALESCE(SUM(
CASE
 WHEN m.ActualHomeGoals IS NULL OR m.ActualAwayGoals IS NULL OR p.HomeGoals IS NULL OR p.AwayGoals IS NULL THEN 0
 WHEN p.HomeGoals=m.ActualHomeGoals AND p.AwayGoals=m.ActualAwayGoals THEN 3
 WHEN ((p.HomeGoals-p.AwayGoals)=0 AND (m.ActualHomeGoals-m.ActualAwayGoals)=0)
   OR ((p.HomeGoals-p.AwayGoals)>0 AND (m.ActualHomeGoals-m.ActualAwayGoals)>0)
   OR ((p.HomeGoals-p.AwayGoals)<0 AND (m.ActualHomeGoals-m.ActualAwayGoals)<0) THEN 1
 ELSE 0 END),0) AS Points
FROM Predictions p JOIN Matches m ON m.Id=p.MatchId WHERE p.UserId=$u";
            cmd.Parameters.AddWithValue("$u", u.Id);
            await using var r = await cmd.ExecuteReaderAsync();
            await r.ReadAsync();
            board.Add(new { u.Id, u.Name, Predictions = r.GetInt32(0), Points = r.GetInt32(1) });
        }
        return board.OrderByDescending(x => (int)x.GetType().GetProperty("Points")!.GetValue(x)!).ToList<object>();
    }

    public static async Task<List<object>> GetRound32Leaderboard(string cs)
    {
        var users = new List<(int Id, string Name)>();
        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using (var cmd = con.CreateCommand())
        {
            cmd.CommandText = "SELECT Id, Name FROM Users ORDER BY Id";
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync()) users.Add((r.GetInt32(0), r.GetString(1)));
        }

        var board = new List<object>();
        foreach (var u in users)
        {
            await using var cmd = con.CreateCommand();
            cmd.CommandText = @"
SELECT COUNT(p.MatchId), COALESCE(SUM(
CASE
 WHEN m.ActualHomeGoals IS NULL OR m.ActualAwayGoals IS NULL OR p.HomeGoals IS NULL OR p.AwayGoals IS NULL THEN 0
 WHEN p.HomeGoals=m.ActualHomeGoals AND p.AwayGoals=m.ActualAwayGoals THEN 3
 WHEN ((p.HomeGoals-p.AwayGoals)=0 AND (m.ActualHomeGoals-m.ActualAwayGoals)=0)
   OR ((p.HomeGoals-p.AwayGoals)>0 AND (m.ActualHomeGoals-m.ActualAwayGoals)>0)
   OR ((p.HomeGoals-p.AwayGoals)<0 AND (m.ActualHomeGoals-m.ActualAwayGoals)<0) THEN 1
 ELSE 0 END),0) AS Points
FROM Round32Predictions p JOIN Round32Matches m ON m.Id=p.MatchId WHERE p.UserId=$u";
            cmd.Parameters.AddWithValue("$u", u.Id);
            await using var r = await cmd.ExecuteReaderAsync();
            await r.ReadAsync();
            board.Add(new { u.Id, u.Name, Predictions = r.GetInt32(0), Points = r.GetInt32(1) });
        }

        return board.OrderByDescending(x => (int)x.GetType().GetProperty("Points")!.GetValue(x)!).ToList<object>();
    }

    public static async Task<string> ExportPredictionsCsv(string cs, int userId, string userName)
    {
        var sb = new StringBuilder($"Predections for {userName}\n\n");
        sb.AppendLine("Group,Home Team,Away Team,Kick off,Home Goals,Away Goals");

        await using var con = new SqliteConnection(cs); await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = @"
SELECT m.GroupName, m.HomeTeam, m.AwayTeam, m.KickoffUtc, p.HomeGoals, p.AwayGoals
FROM Matches m
LEFT JOIN Predictions p ON p.MatchId = m.Id AND p.UserId = $u
ORDER BY m.Id";
        cmd.Parameters.AddWithValue("$u", userId);
        await using var r = await cmd.ExecuteReaderAsync();

        while (await r.ReadAsync())
        {
            sb.Append(Csv(r.GetString(0).ToString())).Append(',')
              .Append(Csv(r.GetString(1))).Append(',')
              .Append(Csv(r.GetString(2))).Append(',')
              .Append(Csv(r.GetDateTime(3).ToString("MM/dd/yyyy HH:mm"))).Append(',')
              .Append(Csv(r.IsDBNull(4) ? "" : r.GetString(4))).Append(',')
              .Append(Csv(r.IsDBNull(5) ? "" : r.GetString(5))).Append(',')
              .AppendLine();              
        }

        return sb.ToString();
    }

    public static string ToSafeFilePart(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var safe = new string(value.Select(c => invalid.Contains(c) ? '_' : c).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(safe) ? "user" : safe;
    }

    static string Csv(string value)
    {
        if (value.Contains('"')) value = value.Replace("\"", "\"\"");
        return value.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0 ? $"\"{value}\"" : value;
    }

    static void Exec(SqliteConnection con, string sql) { using var cmd = con.CreateCommand(); cmd.CommandText = sql; cmd.ExecuteNonQuery(); }
    static long ScalarLong(SqliteConnection con, string sql) { using var cmd = con.CreateCommand(); cmd.CommandText = sql; return (long)(cmd.ExecuteScalar() ?? 0L); }
}
