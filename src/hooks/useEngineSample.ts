import { useEffect, useRef, useState } from 'react';
import type { SimulationEngine } from '../simulation/SimulationEngine';

/**
 * Samples engine state into React at a fixed rate.
 *
 * The simulation runs at 60 fps; re-rendering the telemetry panel that often
 * would compete with the Blockly workspace for the main thread for no visible
 * benefit. 10 Hz already looks continuous to the eye.
 */
export function useEngineSample<T>(
  engine: SimulationEngine,
  select: (engine: SimulationEngine) => T,
  hz = 10,
): T {
  const [value, setValue] = useState<T>(() => select(engine));
  const selectRef = useRef(select);
  selectRef.current = select;

  useEffect(() => {
    const period = 1000 / hz;
    let last = 0;

    const unsubscribe = engine.subscribeFrame(() => {
      const now = performance.now();
      if (now - last < period) return;
      last = now;
      setValue(selectRef.current(engine));
    });

    return unsubscribe;
  }, [engine, hz]);

  return value;
}
