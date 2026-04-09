import React from 'react';
import { IndoorNavigatorApp } from './src/components/IndoorNavigatorApp';
import { useMockBLEScanner } from './src/hooks/useMockBLEScanner';

export default function App() {
  const controller = useMockBLEScanner();
  return <IndoorNavigatorApp controller={controller} dataMode="mock" />;
}
