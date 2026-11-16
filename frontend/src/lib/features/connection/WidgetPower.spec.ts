import { emptyEstimate } from '../../../../backend-mock/battery';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { LiveSample } from '../../backend/contract';
import { estimatedBatteryPercent } from './battery';
import GaugePower from './WidgetPower.svelte';

describe('battery power gauge', () => {
  it('rounds one estimate for text, gauge fill, color and accessibility', () => {
    const estimate = { ...emptyEstimate(), level: 0.1949, seriesCount: 20 };
    const sample = { packVoltageV: 72, batteryLevel: 0.8, charging: true } as LiveSample;
    const { body } = render(GaugePower, { props: { sample, estimate } });
    expect(estimatedBatteryPercent(estimate)).toBe(19);
    expect(body).toContain('19%');
    expect(body).toContain('aria-valuenow="19"');
    expect(body).toContain('19 percent');
    expect(body).toContain('width: 19%');
    expect(body).toContain('rgb(220, 38, 38)');
    expect(body).toContain('Charging');
    expect(body).toContain('3.60 V');
    expect(estimatedBatteryPercent({ ...estimate, level: 0.195 })).toBe(20);
    expect(estimatedBatteryPercent(null)).toBeNull();
  });
  it('does not substitute controller charge when the estimate is unavailable', () => {
    const sample = { packVoltageV: 72, batteryLevel: 0.8, charging: false } as LiveSample;
    const { body } = render(GaugePower, { props: { sample, estimate: emptyEstimate() } });
    expect(body).not.toMatch(/<output[^>]*>80%<\/output>/);
    expect(body).toContain('72.0 V');
    expect(body).toContain('width: 0%');
    expect(body).toContain('aria-valuetext="Unavailable"');
    expect(body).not.toContain('aria-valuenow=');
  });

  it('shows pack and per-cell voltage when the configured series count is available', () => {
    const sample = {
      packVoltageV: 75.6,
      batteryLevel: 0.64,
      charging: false,
    } as LiveSample;
    const { body } = render(GaugePower, {
      props: { sample, estimate: { ...emptyEstimate(), level: 0.5, seriesCount: 18 } },
    });

    expect(body).toContain('75.6 V');
    expect(body).toContain('4.20 V');
    expect(body).toContain('50%');
  });

  it('uses subtle text for unavailable voltage and percentage labels', () => {
    const sample = {
      packVoltageV: null,
      batteryLevel: null,
      charging: false,
    } as LiveSample;
    const { body } = render(GaugePower, {
      props: { sample, estimate: emptyEstimate() },
    });

    expect(body.match(/text-muted/g)).toHaveLength(4);
    expect(body.match(/>—<\/span>|>—<\/output>/g)).toHaveLength(1);
  });
});

it('renders reported fill and an actionable warning for missing configuration', () => {
  const { body } = render(GaugePower, {
    props: {
      sample: { packVoltageV: 72, batteryLevel: 0.8 } as LiveSample,
      estimate: { ...emptyEstimate(), unavailableReason: 'not_configured', seriesCount: 20 },
      savedBoard: true,
      onconfigure: () => {},
    },
  });
  expect(body).toContain('aria-label="Controller-reported battery level"');
  expect(body).toContain('aria-valuenow="80"');
  expect(body).toContain('width: 80%');
  expect(body).toContain('Battery setup required');
  expect(body).toContain('3.60 V');
});

for (const dashboard of [false, true]) {
  it(`shows a low warning around the full track at 1% (dashboard=${dashboard})`, () => {
    const { body } = render(GaugePower, {
      props: {
        dashboard,
        warning: 'low',
        sample: { packVoltageV: 60.1, charging: true } as LiveSample,
        estimate: { ...emptyEstimate(), level: 0.01, seriesCount: 20 },
      },
    });
    expect(body).toContain('Battery low');
    expect(body).toContain('role="status"');
    expect(body).toContain('battery-warning');
    expect(body).toContain('aria-valuenow="1"');
    expect(body).toContain('width: 1%');
    expect(body).not.toContain('Charging');
    expect(body).not.toContain('battery-charging-pulse');
  });
  it(`shows over voltage without changing full charge (dashboard=${dashboard})`, () => {
    const { body } = render(GaugePower, {
      props: {
        dashboard,
        warning: 'overVoltage',
        sample: { packVoltageV: 85, charging: true } as LiveSample,
        estimate: { ...emptyEstimate(), level: 1, seriesCount: 20 },
      },
    });
    expect(body).toContain('Over voltage');
    expect(body).toContain('over-voltage');
    expect(body).toContain('width: 100%');
    expect(body).toContain('aria-valuenow="100"');
    expect(body).not.toContain('Charging');
  });
}
it('does not invent charge when a voltage warning has no charge estimate', () => {
  const { body } = render(GaugePower, { props: { warning: 'low', sample: null, estimate: emptyEstimate() } });
  expect(body).toContain('Battery low');
  expect(body).toContain('aria-valuetext="Unavailable"');
  expect(body).not.toContain('aria-valuenow=');
});

for (const dashboard of [false, true]) {
  it(`explains a cell-count mismatch without substituting controller charge (dashboard=${dashboard})`, () => {
    const { body } = render(GaugePower, {
      props: {
        dashboard,
        savedBoard: true,
        sample: { packVoltageV: 57.7, batteryLevel: 0.55 } as LiveSample,
        estimate: { ...emptyEstimate(), unavailableReason: 'series_mismatch' },
      },
    });
    expect(body).toContain(dashboard ? 'Setup mismatch' : 'Battery setup mismatch');
    expect(body).toContain('aria-valuetext="Unavailable"');
    expect(body).not.toContain('aria-valuenow=');
    expect(body).not.toContain('55%');
  });
}
