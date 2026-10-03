export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface SoilData {
  nitrogen: number; // mg/kg
  phosphorus: number; // mg/kg
  potassium: number; // mg/kg
  ph: number;
  moisture: number; // %
}

export interface WeatherData {
  temp: number;
  condition: string;
  humidity: number;
  forecast: string;
}

export interface CropRecommendation {
  crop: string;
  confidence: number;
  reason: string;
}
