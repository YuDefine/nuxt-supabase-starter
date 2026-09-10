// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/instruction/TimeControl.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/instruction/TimeControl.ts
import type { ScenarioContext } from '../context/ScenarioContext.js';
import { TimeService, DateTimeTZ } from '../helper/TimeService.js';
import { SpecFormulaArgumentError } from '../error/SpecFormulaError.js';

/**
 * TimeControl — sets and retrieves mocked time in ScenarioContext.
 *
 * Supports:
 *  - Plain ISO date: "2025-12-25"
 *  - ISO datetime without timezone: "2025-11-04T08:00:00"
 *  - ISO datetime with timezone: "2025-12-25T14:30:00+08:00"
 *  - ISO datetime UTC: "2025-12-25T06:30:00Z"
 *  - @time() expression: "@time(2025-12-25T14:30:00+08:00)"
 *  - @time() with quotes: "@time(\"2025-12-24T02:36:54-12:00\")"
 *  - @time(now), @time(now-1d), @time(now+2h-30m)
 *  - @date() expression: "@date(2025-12-16)"
 *
 * Throws an error for empty or whitespace-only strings.
 */
export class TimeControl {
  constructor(private readonly context: ScenarioContext) {}

  /**
   * Set the mocked "now" time in context.
   * Supports all formats described above.
   */
  setNow(timeExpr: string): void {
    if (!timeExpr || timeExpr.trim() === '') {
      throw new SpecFormulaArgumentError({
        code: 'EXEC_TIME_PARAM_MISSING',
        details: {},
      });
    }

    const trimmed = timeExpr.trim();

    // @time() or @date() expression — resolve via TimeService
    if (trimmed.startsWith('@time(') || trimmed.startsWith('@date(')) {
      const resolved = TimeService.resolveTimeExpression(trimmed, this.context);
      // Store as DateTimeTZ in context (TimeService.setNow takes ISO string)
      // For @time(), we get a DateTimeTZ — store it directly
      if (resolved instanceof DateTimeTZ) {
        this.context.set('now', resolved);
        return;
      }
      // For @date(), we get DateOnly — convert to DateTimeTZ
      const isoStr = resolved.toString();
      TimeService.setNow(isoStr, this.context);
      return;
    }

    // Plain date/datetime string — delegate to TimeService.setNow
    TimeService.setNow(trimmed, this.context);
  }

  /**
   * Get the current mocked "now" time.
   * Returns DateTimeTZ (either mocked or real current time).
   */
  getNow(): DateTimeTZ {
    return TimeService.getNow(this.context);
  }
}
