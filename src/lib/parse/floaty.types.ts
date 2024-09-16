import { z } from 'zod';

export type ZLocation = z.infer<typeof LocationSchema>;
export const LocationSchema = z.object({
  timestamp: z.number(),
  altitude: z.number(),
  latitude: z.number(),
  speed: z.number(),
  longitude: z.number(),
  accuracy: z.number(),
});

export type ZLog = z.infer<typeof LogSchema>;
export const LogSchema = z.object({
  timestamp: z.number(),
  speed: z.number(),
  dutyCycle: z.number(),
  batteryVolts: z.number(),
  batteryPercent: z.number(),
  batteryCurrent: z.number(),
  motorCurrent: z.number(),
  motorTemp: z.number(),
  controllerTemp: z.number(),
  tripDistance: z.number(),
  lifeDistance: z.number(),
  remainingDistance: z.number(),
  rollAngle: z.number(),
  pitchAngle: z.number(),
  truePitchAngle: z.number(),
  inputTilt: z.number(),
  throttle: z.number(),
  ampHours: z.number(),
  wattHours: z.number(),
  state: z.number(),
  switchState: z.number(),
  setpointAdjustmentType: z.number(),
  faultCode: z.number(),
  adc1: z.number(),
  adc2: z.number(),
});

export type ZFloatyJson = z.infer<typeof FloatyJsonSchema>;
export const FloatyJsonSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  boardId: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  stopReason: z.number(),
  polyline: z.string(),
  distance: z.number(),
  locations: LocationSchema.array(),
  logs: LogSchema.array(),
});
