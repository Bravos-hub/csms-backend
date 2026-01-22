export interface SiteStatsDto {
    // Aggregated metrics from all charge points at the site
    totalRevenue: number; // Sum of all session.amount values (USD)
    totalSessions: number; // Count of all sessions
    totalEnergy: number; // Sum of all session energy in kWh
    averageSessionDuration?: number; // Average duration in minutes (optional)

    // Additional useful metrics
    activeSessions: number; // Count of currently active sessions
    completedSessions: number; // Count of completed sessions
}
