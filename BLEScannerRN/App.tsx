import React, { useState } from 'react';
import { BLEWorkspace } from './src/components/BLEWorkspace';
import { useBLEScanner } from './src/hooks/useBLEScanner';
import { useMockBLEScanner } from './src/hooks/useMockBLEScanner';
import { ScannerDataMode } from './src/utils/types';

interface ModeProps {
  mode: ScannerDataMode;
  onChangeMode: (mode: ScannerDataMode) => void;
}

function LiveBLEExperience({ mode, onChangeMode }: ModeProps) {
  const controller = useBLEScanner();
  return (
    <BLEWorkspace
      controller={controller}
      dataMode={mode}
      onChangeDataMode={onChangeMode}
    />
  );
}

function MockBLEExperience({ mode, onChangeMode }: ModeProps) {
  const controller = useMockBLEScanner();
  return (
    <BLEWorkspace
      controller={controller}
      dataMode={mode}
      onChangeDataMode={onChangeMode}
    />
  );
}

export default function App() {
  const [mode, setMode] = useState<ScannerDataMode>('mock');

  if (mode === 'live') {
    return <LiveBLEExperience mode={mode} onChangeMode={setMode} />;
  }

  return <MockBLEExperience mode={mode} onChangeMode={setMode} />;
}
