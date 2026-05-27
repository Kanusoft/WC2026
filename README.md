# World Cup 2026 Prediction Pool

A small ASP.NET Core + SQLite web app for a private World Cup prediction pool.

## Features

- Friend login with simple PINs
- Each friend enters predicted scores for group-stage matches
- Akkad admin can edit teams/venues and enter actual results
- Automatic scoring:
  - 3 points for exact score
  - 1 point for correct outcome: win / lose / tie
- Live leaderboard
- CSV leaderboard export

## Default logins

Change these before sharing publicly.

| Name | PIN | Role |
|---|---:|---|
| Eli | 1111 | Player |
| Sargon | 2222 | Player |
| Jacob | 3333 | Player |
| Zuhir | 4444 | Player |
| Akkad | 9999 | Admin |

## Run locally

```bash
dotnet restore
dotnet run
```

Open the local URL shown by .NET.

## Deploy to Azure App Service

1. Create an Azure App Service using .NET 8 runtime.
2. In this project folder, publish:

```bash
dotnet publish -c Release -o publish
```

3. Zip the contents of the `publish` folder and deploy through Azure App Service > Deployment Center, VS Code Azure extension, or Azure CLI.
4. The app stores data in `App_Data/worldcup2026pool.db` using SQLite. For a small private pool this is fine. For a larger/public app, switch to Azure SQL.

## Important

The app is seeded with placeholder group-stage matches: 12 groups × 6 matches = 72 group matches. Use the Admin panel to replace placeholder teams with the official teams/fixtures.
