import { lookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import { config } from '../config.js'

export function isPrivateAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address.split('%')[0] || '')
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      parsed = (parsed as ipaddr.IPv6).toIPv4Address()
    }
    // ipaddr classifies loopback, private, CGNAT, link-local, mapped/NAT64,
    // multicast, documentation and other special-purpose ranges separately.
    return parsed.range() !== 'unicast'
  } catch {
    return true
  }
}

export async function resolveAllowedHost(host: string): Promise<string> {
  const value = host.trim().toLowerCase()
  if (!value || value === 'localhost' || value.endsWith('.local')) {
    throw new Error('TARGET_NOT_ALLOWED')
  }
  const records = await lookup(value, { all: true, verbatim: true })
  if (!records.length) throw new Error('TARGET_NOT_RESOLVED')
  if (!config.ALLOW_PRIVATE_TARGETS && records.some((record) => isPrivateAddress(record.address))) {
    throw new Error('PRIVATE_TARGET_NOT_ALLOWED')
  }
  return records[0]!.address
}
