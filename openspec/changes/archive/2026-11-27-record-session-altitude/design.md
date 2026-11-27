# Design

Use a nullable `altitude_m` column on the existing location table so the same transaction, paging boundary and pruning operation cover the whole point. The writer adds the column in the first transaction that retains altitude. Readers detect the column in their read transaction and project null from older tables. Existing files need no bulk rewrite. Apple uses valid Core Location ellipsoidal altitude and Android uses `Location` altitude when present. The shared fact carries only finite values or null. Route eligibility, sampling, and calibration policy are unchanged.

Format 5 uses the same SQLite archive envelope as format 4 with the altitude column in its exact schema. Choose the version from the staged export's schema. Validate the version and corresponding schema before admitting staged imports. Preserve format 4 as the output for recordings still using its schema. App-data transfer reuses those embedded session archives.

Publish owned-storage marker 102 after validating the unchanged catalog. The explicit 101 to 102 transition changes only the marker and is restartable through atomic marker publication. A 100 root completes its existing catalog upgrade first. The marker protects altitude-capable recordings from earlier builds that could otherwise open a session and mislabel its export as format 4. Recording and archive writes continue to use the existing transaction and staging boundaries.

The elevation chart reuses the complete bounded track already loaded for the map and uses the existing session chart timeline and selection. Render real altitude only, breaking the plot at missing readings, route gaps, and excluded map-filter intervals. Hide the chart for sessions with no altitude and label the WGS84 reference for correct interpretation.

Expose altitude on the latest accepted route fix in authoritative live state. Clear the fix when route capture stops or restarts. The widgets reuse the existing numeric renderer and distance-unit preference and show unavailable if the current fix has no usable altitude or is stale. Custom View also supports the existing bounded local trend, with only the altitude and observation time carried into its in-memory readings. The widgets consume existing route capture without requesting location or changing its lifecycle.

No datum conversion, external geoid model, or CSV column is needed. Missing altitude remains null through reads and round trips. Confirm Hermes's expected datum separately before mapping an upload payload.
