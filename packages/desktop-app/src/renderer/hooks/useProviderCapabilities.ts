import { useEffect, useState } from 'react';
import { ProviderCapabilitiesDTO } from '../../shared/dtos';
import { providerDisplayName } from '../../shared/provider-names';

/**
 * What the active provider can do, and its name, as main reads them.
 *
 * `null` until main has answered: a control that depends on a capability is
 * hidden until it is known, never shown and then taken away. The name is
 * "your provider" meanwhile, so a sentence still reads.
 */
export const useProviderCapabilities = (): { capabilities: ProviderCapabilitiesDTO | null; providerName: string } => {
  const [capabilities, setCapabilities] = useState<ProviderCapabilitiesDTO | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getProviderCapabilities) return undefined;
    let live = true;
    api
      .getProviderCapabilities()
      .then(value => {
        if (live) setCapabilities(value);
      })
      .catch(err => console.warn('[useProviderCapabilities] Could not read the provider:', err));
    return () => {
      live = false;
    };
  }, []);

  return { capabilities, providerName: providerDisplayName(capabilities?.providerId) };
};
