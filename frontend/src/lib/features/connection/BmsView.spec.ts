import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { BmsSnapshot, BmsState } from '$lib/backend/contract';
import BmsView from './BmsView.svelte';

const snapshot: BmsSnapshot = {
  observedAt: '2020-01-01T00:00:00.000Z',
  totalVoltageV: 63.5,
  chargeVoltageV: 75.6,
  inputCurrentA: -3.25,
  inputIcCurrentA: -3.2,
  sessionAmpHoursAh: 1.2,
  sessionWattHoursWh: 73.4,
  cellVoltagesV: Array.from({ length: 50 }, (_, index) => 3.5 + index / 1000),
  balancing: Array.from({ length: 50 }, (_, index) => index === 49),
  temperaturesC: Array.from({ length: 50 }, (_, index) => 20 + index / 10),
  icTemperatureC: 30,
  humiditySensorTemperatureC: 25,
  humidityPercent: 55.5,
  highestCellTemperatureC: 31,
  highestCircuitryTemperatureC: 35,
  stateOfCharge: 0.8,
  stateOfHealth: 0.95,
  reportedCanId: 42,
  lifetimeChargeAmpHoursAh: 100,
  lifetimeChargeWattHoursWh: 6_000,
  lifetimeDischargeAmpHoursAh: 90,
  lifetimeDischargeWattHoursWh: 5_400,
  pressurePa: 101_325,
  dataVersion: 2,
  status: 'balancing',
};

const attached: BmsState = {
  status: 'attached',
  connection: { kind: 'can', canId: 42 },
  candidates: [],
  latestSnapshot: snapshot,
};

describe('BMS view', () => {
  it('names version 1 temperatures and shows each reading once', () => {
    const { body } = render(BmsView, {
      props: {
        units: 'metric',
        bms: {
          ...attached,
          latestSnapshot: {
            ...snapshot,
            dataVersion: 1,
            temperaturesC: [41, 26.4, 27.3, 30.5, -300, 26.8, 27.3, 26.8, 26.4],
            icTemperatureC: 41,
            highestCellTemperatureC: 27.3,
            humiditySensorTemperatureC: 33.3,
          },
        },
      },
    });
    const readings = [...body.matchAll(/aria-label="([^"]+) temperature"[^>]*aria-valuetext="([^"]+)"/g)];
    expect(readings.map(([, label, value]) => [label, value])).toEqual([
      ['Coldest cell probe', '26.4 °C'],
      ['Hottest cell probe', '27.3 °C'],
      ['Cell probe 1', '26.8 °C'],
      ['Cell probe 2', '27.3 °C'],
      ['Cell probe 3', '26.8 °C'],
      ['Cell probe 4', '26.4 °C'],
      ['BMS chip', '41.0 °C'],
      ['BMS MOSFETs', '30.5 °C'],
      ['Ambient', 'Unavailable'],
      ['Humidity sensor', '33.3 °C'],
    ]);
  });

  it.each(['metric', 'imperial'] as const)('marks missing temperature sensors unavailable in %s units', (units) => {
    const { body } = render(BmsView, {
      props: {
        units,
        bms: {
          ...attached,
          latestSnapshot: {
            ...snapshot,
            temperaturesC: [-300, -10, 0],
            icTemperatureC: -300,
            highestCellTemperatureC: -300,
            humiditySensorTemperatureC: -300,
          },
        },
      },
    });
    const cards = [...body.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map((match) => match[0]);
    for (const name of ['Sensor 1', 'IC', 'Highest cell', 'Humidity sensor']) {
      const card = cards.find((html) => html.includes(`aria-label="${name} temperature"`))!;
      expect(card).toBeDefined();
      expect(card).toContain('opacity-50');
      expect(card).toContain('Unavailable');
      expect(card).toContain('aria-valuetext="Unavailable"');
      expect(card).not.toContain('aria-valuenow');
      expect(card).toContain('width: 0%');
    }
    expect(body).not.toContain('-300');
    expect(body).not.toContain('-508');
    expect(body).toContain(units === 'metric' ? 'aria-valuetext="-10.0 °C"' : 'aria-valuetext="14.0 °F"');
    expect(body).toContain(units === 'metric' ? 'aria-valuetext="0.0 °C"' : 'aria-valuetext="32.0 °F"');
  });

  it('clamps cell and temperature bars while retaining exact readings and shared colours', () => {
    const { body } = render(BmsView, {
      props: {
        units: 'metric',
        bms: {
          ...attached,
          latestSnapshot: { ...snapshot, cellVoltagesV: [2.9, 3.42, 4.3], temperaturesC: [-10, 45, 110] },
        },
      },
    });
    expect(body).toContain('2.900 V');
    expect(body).toContain('4.300 V');
    expect(body).toContain('width: 0%');
    expect(body).toContain('width: 100%');
    expect(body).toContain('--cell-color: rgb(220, 38, 38)');
    expect(body).toContain('--cell-color: rgb(234, 179, 8)');
    expect(body).toContain('--cell-color: rgb(22, 163, 74)');
    expect(body).toContain('--temperature-color: rgb(234, 88, 12)');
    expect(body).toContain('aria-valuetext="110.0 °C"');
  });
  it('renders the maximum bounded arrays, optional tail, route, and imperial temperatures', () => {
    const { body } = render(BmsView, { props: { bms: attached, units: 'imperial' } });
    const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

    expect(text).toContain('CAN 42');
    expect(text).toContain('Cell 50');
    expect(text).toContain('3.549 V · balancing');
    expect(text).toContain('Sensor 50: 76.8 °F');
    expect(text).toContain('Reported CAN ID');
    expect(text).toContain('balancing');
    expect(text).toContain('IC current');
    expect(text).toContain('-3.20 A');
  });

  it('sorts ambiguous routes and directs configuration without showing value placeholders', () => {
    const bms: BmsState = {
      status: 'ambiguous',
      connection: null,
      latestSnapshot: null,
      candidates: [
        { connection: { kind: 'can', canId: 42 }, hardwareName: 'VBMS 42', vescVersion: '6.00' },
        { connection: { kind: 'can', canId: 3 }, hardwareName: 'VBMS 3', vescVersion: '6.00' },
        { connection: { kind: 'direct' }, hardwareName: 'Local VBMS', vescVersion: '6.00' },
      ],
    };
    const { body } = render(BmsView, { props: { bms, units: 'metric' } });
    const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

    expect(text).toContain('Set Preferred BMS CAN ID in Board configuration');
    expect(text.indexOf('Local VBMS')).toBeLessThan(text.indexOf('VBMS 3'));
    expect(text.indexOf('VBMS 3')).toBeLessThan(text.indexOf('VBMS 42'));
    expect(text).not.toContain('BMS values will appear');
  });

  it('retains stale values and their original freshness while unavailable', () => {
    const { body } = render(BmsView, {
      props: { bms: { ...attached, status: 'unavailable' }, units: 'metric' },
    });
    const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

    expect(text).toContain('Readings below may be out of date.');
    expect(text).toContain('ago');
    expect(text).toContain('30.0 °C');
    expect(text).toContain('63.50 V');
  });
});
