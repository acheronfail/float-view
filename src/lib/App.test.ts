import { expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import App from './App.svelte';

test('it works', () => {
  const screen = render(App, {});
  expect(screen.getByTestId('map')).toBeInTheDocument();
  expect(screen.getByTestId('chart_speed')).toBeInTheDocument();
  expect(screen.getByTestId('chart_duty_cycle')).toBeInTheDocument();
  expect(screen.getByTestId('chart_battery_voltage')).toBeInTheDocument();
  expect(screen.getByTestId('chart_elevation')).toBeInTheDocument();
  expect(screen.getByTestId('chart_i-mot_/_i-batt')).toBeInTheDocument();
  expect(screen.getByTestId('chart_t-mot_/_t-mosfet')).toBeInTheDocument();
});
