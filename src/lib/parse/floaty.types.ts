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
  adc1: z.number().nullable(),
  adc2: z.number().nullable(),
  ampHours: z.number().nullable(),
  batteryCurrent: z.number().nullable(),
  batteryPercent: z.number().nullable(),
  batteryVolts: z.number().nullable(),
  controllerTemp: z.number().nullable(),
  dutyCycle: z.number().nullable(),
  faultCode: z.number().nullable(),
  inputTilt: z.number().nullable(),
  lifeDistance: z.number().nullable(),
  motorCurrent: z.number().nullable(),
  motorTemp: z.number().nullable(),
  pitchAngle: z.number().nullable(),
  remainingDistance: z.number().nullable(),
  rollAngle: z.number().nullable(),
  setpointAdjustmentType: z.number().nullable(),
  speed: z.number().nullable(),
  state: z.number().nullable(),
  switchState: z.number().nullable(),
  throttle: z.number().nullable(),
  timestamp: z.number(),
  tripDistance: z.number().nullable(),
  truePitchAngle: z.number().nullable(),
  wattHours: z.number().nullable(),
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
