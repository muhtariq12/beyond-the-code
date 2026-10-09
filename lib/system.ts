export type NodeId = "form" | "identity" | "units" | "sync" | "netsuite" | "access";

export type SystemNode = {
  id: NodeId;
  label: string;
  sub: string;
  role: string;
  fails: string;
  tenantSees: string;
  investigate: string;
};

export const nodes: Record<NodeId, SystemNode> = {
  form: {
    id: "form",
    label: "Registration form",
    sub: "What the tenant sees",
    role: "Collects a few details and turns them into a request the rest of the system can act on. It owns almost no truth itself. It asks other systems what is true.",
    fails:
      "The form accepts a unit number that looks valid but means different things in different buildings, and passes it on without noticing.",
    tenantSees: "A success screen. Nothing looks wrong at this point.",
    investigate:
      "Log the exact values submitted next to the record the lookup returned. If they disagree, the form is only the messenger.",
  },
  identity: {
    id: "identity",
    label: "Identity & account",
    sub: "Who is this person?",
    role: "Decides whether this person already exists, creates the account if not, and holds the credentials. Everything later is attached to this identity.",
    fails:
      "Two registrations for the same person create two accounts, or one account is created for a phone number that someone else already uses.",
    tenantSees: "Duplicate accounts, or a login that opens someone else's profile.",
    investigate:
      "Count accounts per phone number and email. Check which unique constraint, if any, the database actually enforces.",
  },
  units: {
    id: "units",
    label: "Property & units",
    sub: "Which unit is theirs?",
    role: "Holds the buildings, units and the link from a tenant to a unit. The application reads this table at registration and trusts it.",
    fails:
      "A unit is identified by a code that is only unique within one building, so a lookup on the code alone can match the wrong unit.",
    tenantSees: "Another unit's lease, balance or notices.",
    investigate:
      "Check whether the key used by the lookup is actually unique. Query for codes that appear in more than one property.",
  },
  sync: {
    id: "sync",
    label: "Sync layer",
    sub: "Keeps systems agreeing",
    role: "Copies data from the ERP into the application's database on some schedule or trigger, and maps one system's fields onto the other's.",
    fails:
      "A job fails quietly, or runs late, and the application keeps serving a unit's old state while the ERP has moved on.",
    tenantSees: "A unit that was re-let months ago still shows the previous arrangement.",
    investigate:
      "Compare the ERP's last-modified time with the application's last-synced time for the same record. Read the job logs for skipped rows.",
  },
  netsuite: {
    id: "netsuite",
    label: "NetSuite ERP",
    sub: "System of record",
    role: "The finance and property source of truth for leases and units. The application should agree with it, not compete with it.",
    fails:
      "A record is edited, merged or renamed in the ERP in a way the integration never anticipated, such as a unit code with trailing spaces.",
    tenantSees: "Usually nothing directly. The error arrives later, through the sync layer.",
    investigate:
      "Pull a raw export, not the cleaned one the integration produces, and read the real values character by character.",
  },
  access: {
    id: "access",
    label: "Access rules",
    sub: "What can they see?",
    role: "Uses the tenant's identity and linked unit to decide which information a logged-in person may see.",
    fails:
      "Permissions are derived from a mapping that is wrong, so the system correctly enforces access to the wrong thing.",
    tenantSees: "Private information that belongs to a different tenant.",
    investigate:
      "Test access as a specific tenant against a known unit, then try to reach a unit that is not theirs. The second test matters more.",
  },
};

/** Data flows from source to destination. Failures travel the same way. */
export const edges: { from: NodeId; to: NodeId; label: string }[] = [
  { from: "netsuite", to: "sync", label: "export" },
  { from: "sync", to: "units", label: "map & copy" },
  { from: "units", to: "form", label: "lookup" },
  { from: "form", to: "identity", label: "create" },
  { from: "identity", to: "access", label: "who" },
  { from: "units", to: "access", label: "which unit" },
];

export function downstream(start: NodeId): Set<NodeId> {
  const seen = new Set<NodeId>();
  const queue: NodeId[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.from === cur && !seen.has(e.to) && e.to !== start) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return seen;
}

export type Layout = {
  viewBox: [number, number];
  size: [number, number];
  pos: Record<NodeId, [number, number]>;
};

export const layouts: Record<"wide" | "narrow", Layout> = {
  wide: {
    viewBox: [1000, 400],
    size: [190, 76],
    pos: {
      identity: [270, 20],
      access: [560, 20],
      form: [0, 170],
      units: [270, 300],
      sync: [560, 300],
      netsuite: [810, 300],
    },
  },
  narrow: {
    viewBox: [360, 470],
    size: [164, 70],
    pos: {
      identity: [0, 0],
      access: [196, 0],
      form: [0, 133],
      units: [196, 133],
      sync: [196, 266],
      netsuite: [196, 399],
    },
  },
};
