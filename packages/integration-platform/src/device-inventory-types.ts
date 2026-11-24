// ============================================================================
// Device Inventory Records
// ============================================================================

/**
 * A device the Dilligent device agent is installed on.
 */
export interface InventoryDevice {
  /** Device ID */
  id: string;
  /** Display name reported by the agent */
  name: string;
  hostname: string;
  platform: 'macos' | 'windows' | 'linux';
  osVersion: string;
  serialNumber: string | null;
  hardwareModel: string | null;
  /** The person the device is assigned to */
  owner: {
    memberId: string;
    /** Primary email, already lowercased and trimmed by the host */
    email: string;
    name: string | null;
  };
  /** ISO timestamp of the agent's last check in, if it has checked in */
  lastCheckIn: string | null;
  /** ISO timestamp of when the agent was installed */
  installedAt: string;
}

/**
 * Host-supplied read access to the organization's device inventory.
 */
export interface DeviceInventoryProvider {
  /**
   * Devices running the Dilligent device agent. Devices imported from other
   * integrations such as Mosyle are excluded: those integrations
   * evidence their own inventories.
   */
  getAgentDevices: () => Promise<InventoryDevice[]>;
}
