import csv from 'papaparse';
import { ParseError, type ParseResult } from './index';
import { DataSource, RowKey, Units, type Row, type RowWithIndex } from './types';
import { createHeaderTransformer, parseFloatValue } from '../misc';
import { vescToolToRowMap, type RequiredRowValues } from './vesc.types';

// {
//   "time": "60848530",
//   "voltage": "81.5",
//   "temp_mosfet": "18.8",
//   "temp_mos_1": "18.9",
//   "temp_mos_2": "0",
//   "temp_mos_3": "18.6",
//   "temp_motor": "26.5",
//   "current_motor": "0",
//   "current_battery": "0",
//   "d_axis_current": "0",
//   "q_axis_current": "0",
//   "erpm": "0",
//   "duty": "0.001",
//   "ah": "0.6502",
//   "ah_charged": "0.0577",
//   "wh": "51.836",
//   "wh_charged": "4.7486",
//   "tachometer": "195978",
//   "tachometer_abs": "196754",
//   "encoder_position": "180",
//   "motor_fault": "0",
//   "vesc_id": "102",
//   "d_axis_voltage": "-0.09",
//   "q_axis_voltage": "0.001",
//   "ms_today_setup": "60848444",
//   "amp_hours_setup": "0.6502",
//   "amp_hours_charged_setup": "0.0577",
//   "watt_hours_setup": "51.836",
//   "watt_hours_charged_setup": "4.7486",
//   "battery_level": "0.889",
//   "battery_wh_tot": "313.214",
//   "current_in_setup": "0",
//   "current_motor_setup": "0",
//   "speed": "0",
//   "tacho_meters": "1710.23",
//   "tacho_abs_meters": "1717",
//   "num_vescs": "1",
//   "ms_today_imu": "60800384",
//   "roll": "0",
//   "pitch": "0.295746",
//   "yaw": "0",
//   "accX": "0",
//   "accY": "0",
//   "accZ": "0",
//   "gyroX": "0",
//   "gyroY": "0",
//   "gyroZ": "0",
//   "gnss_posTime": "-1",
//   "gps_latitude": "0.00000000",
//   "gps_longitude": "0.00000000",
//   "altitude": "0.00000000",
//   "gnss_gVel": "0.00000000",
//   "gnss_vVel": "0.00000000",
//   "gps_accuracy": "0.00000000",
//   "gnss_vAcc": "0.00000000",
//   "": "",
//   "index": 0
// }

const transform = <C extends RowKey>(value: string, column: C): Row[C] => {
  switch (column) {
    // @ts-ignore FIXME
    case '':
      return '' as Row[C];
    case RowKey.Duty:
      return parseFloatValue(value) * 100 as Row[C];
    default:
      return parseFloatValue(value) as Row[C];
  }
};

// TODO: convert speed from m/s to km/h
// TODO: parse floats are needed
// TODO: any other mappings as required
export async function parseVescToolCsv(input: string | File): Promise<ParseResult> {
  return new Promise((resolve) => {
    csv.parse<Omit<Row, RequiredRowValues>>(input, {
      header: true,
      delimiter: ';',
      skipEmptyLines: true,
      fastMode: true,
      transformHeader: createHeaderTransformer(vescToolToRowMap),
      transform,
      complete: (results) => {
        console.log('csv parse', results.data.length);
        for (let i = 0; i < results.data.length; ++i) {
          const out = results.data[i] as RowWithIndex;
          out.index = i;
          // RowKey.Adc1 | RowKey.Adc2 | RowKey.Distance | RowKey.State | RowKey.StateRaw | RowKey.TruePitch
          out.adc1 = 0;
          out.adc2 = 0;
          out.distance = 0;
          out.state = 'UNKNOWN';
          out.state_raw = 0;
          out.true_pitch = out.pitch;
        }

        console.log('csv patch');

        resolve({
          source: DataSource.VescTool,
          data: results.data as RowWithIndex[],
          units: Units.Metric,
          error:
            results.errors.length > 0 ? new ParseError('Failed to parse VESC Tool CSV!', results.errors) : undefined,
        });
      },
    });
  });
}
