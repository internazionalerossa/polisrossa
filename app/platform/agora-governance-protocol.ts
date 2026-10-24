/**
 * Deterministic, provider-neutral envelope for future AgoràNode decisions.
 *
 * This module deliberately does not implement membership, networking, log
 * replication, key custody or consensus.  It validates a frozen electorate,
 * authenticates final ballots through caller-supplied Ed25519 verification and
 * derives the same result on every implementation.  A hosting machine is not
 * an elector and therefore has no representation in this contract.
 */
export const AGORA_GOVERNANCE_DECISION_FORMAT = "org.agoranode.governance-decision.v1" as const;
export const AGORA_GOVERNANCE_BALLOT_FORMAT = "org.agoranode.governance-ballot.v1" as const;
export const AGORA_GOVERNANCE_CERTIFICATE_FORMAT = "org.agoranode.governance-quorum-certificate.v1" as const;
export const AGORA_GOVERNANCE_PROTOCOL_VERSION = 1 as const;
export const AGORA_PR2_MEMBERSHIP_FORMAT = "org.agoranode.pr2-membership.v1" as const;
/** Legacy PR3 mandate format kept solely for decoding historical records. Not a current role grant. */
export const AGORA_PR3_MANDATE_RECORD_FORMAT = "org.agoranode.pr3-mandate-record.v1" as const;
export const AGORA_PR3_MAX_MANDATE_MS = 365 * 24 * 60 * 60 * 1000;

export const AGORA_PARTICIPATION_ROLES = Object.freeze({
  PR1: Object.freeze({scope: "personal", nodeBallotWeight: 0, federationElectionWeight: 0, delegateBallotWeight: 0, elected: false, hostingWeight: 0}),
  PR2: Object.freeze({scope: "instance", nodeBallotWeight: 1, federationElectionWeight: 1, federationDeduplication: "one-person-across-nodes", delegateBallotWeight: 0, elected: false, hostingWeight: 0}),
  // PR3 is not a separately elected office: it is an active PR2 of Agorà
  // exercising platform competence, without additional hosting or ballot weight.
  PR3: Object.freeze({scope: "platform-via-agora", sourceNodeId: "agora", nodeBallotWeight: 1,
    federationElectionWeight: 0, delegateBallotWeight: 0, elected: false, hostingWeight: 0,
    requires: "active-agora-pr2"}),
} as const);

export const GOVERNANCE_DECISION_CLASSES = [
  "instance-ordinary",
  "instance-constitutional",
  "mandate-appointment",
  "mandate-recall",
  "appeal",
  "emergency-ratification",
  "pr3-election",
  "pr3-recall",
  "federation-policy",
  "protocol-change",
] as const;

export type GovernanceDecisionClass = (typeof GOVERNANCE_DECISION_CLASSES)[number];
export type GovernanceChamber = "members" | "nodes";
export type GovernanceChoice = "yes" | "no" | "abstain";
export type GovernanceScope = {kind: "instance" | "federation"; id: string};
export type GovernanceElector = {id: string; keyId: `sha256:${string}`};
export type GovernanceElectorate = {
  snapshotId: `sha256:${string}`;
  actors: readonly GovernanceElector[];
};

export type GovernanceDecisionEnvelope = {
  format: typeof AGORA_GOVERNANCE_DECISION_FORMAT;
  protocolVersion: typeof AGORA_GOVERNANCE_PROTOCOL_VERSION;
  networkId: string;
  scope: GovernanceScope;
  decisionClass: GovernanceDecisionClass;
  sequence: number;
  baseCheckpointId: `sha256:${string}`;
  proposalSha256: `sha256:${string}`;
  proposalPath: string;
  opensAt: number;
  closesAt: number;
  appealClosesAt: number;
  electorates: {
    members: GovernanceElectorate;
    nodes: GovernanceElectorate | null;
  };
};

export type GovernanceBallot = {
  format: typeof AGORA_GOVERNANCE_BALLOT_FORMAT;
  protocolVersion: typeof AGORA_GOVERNANCE_PROTOCOL_VERSION;
  decisionDigest: `sha256:${string}`;
  chamber: GovernanceChamber;
  voterId: string;
  choice: GovernanceChoice;
  keyId: `sha256:${string}`;
  /** Required for a node vote: the local assembly decision that mandates it. */
  mandateDecisionDigest: `sha256:${string}` | null;
  /** Base64url Ed25519 signature of governanceBallotMessage(ballot). */
  signature: string;
};

export type GovernanceChamberRule = {
  quorumBps: number;
  approvalBps: number;
  minimumEligible: number;
  minimumYes: number;
};

export type GovernanceDecisionRule = {
  scope: GovernanceScope["kind"];
  chambers: Readonly<Record<GovernanceChamber, GovernanceChamberRule | null>>;
};

const rule = (
  scope: GovernanceScope["kind"],
  members: GovernanceChamberRule,
  nodes: GovernanceChamberRule | null = null,
): GovernanceDecisionRule => Object.freeze({scope, chambers: Object.freeze({members: Object.freeze(members), nodes: nodes ? Object.freeze(nodes) : null})});

/**
 * Constitutional defaults.  Changing this table is itself a protocol change,
 * so consumers must bind the exact source release in their checkpoint.
 */
export const GOVERNANCE_DECISION_RULES: Readonly<Record<GovernanceDecisionClass, GovernanceDecisionRule>> = Object.freeze({
  "instance-ordinary": rule("instance", {quorumBps: 3500, approvalBps: 5001, minimumEligible: 3, minimumYes: 2}),
  "instance-constitutional": rule("instance", {quorumBps: 6000, approvalBps: 6667, minimumEligible: 5, minimumYes: 3}),
  "mandate-appointment": rule("instance", {quorumBps: 5000, approvalBps: 5001, minimumEligible: 5, minimumYes: 3}),
  "mandate-recall": rule("instance", {quorumBps: 3500, approvalBps: 5001, minimumEligible: 3, minimumYes: 2}),
  appeal: rule("instance", {quorumBps: 4000, approvalBps: 5001, minimumEligible: 5, minimumYes: 3}),
  "emergency-ratification": rule("instance", {quorumBps: 3500, approvalBps: 5001, minimumEligible: 5, minimumYes: 3}),
  "pr3-election": rule("federation", {quorumBps: 5000, approvalBps: 5001, minimumEligible: 7, minimumYes: 4}),
  "pr3-recall": rule("federation", {quorumBps: 3500, approvalBps: 5001, minimumEligible: 5, minimumYes: 3}),
  "federation-policy": rule(
    "federation",
    {quorumBps: 5000, approvalBps: 6000, minimumEligible: 7, minimumYes: 4},
    {quorumBps: 5000, approvalBps: 6000, minimumEligible: 3, minimumYes: 2},
  ),
  "protocol-change": rule(
    "federation",
    {quorumBps: 6000, approvalBps: 6667, minimumEligible: 7, minimumYes: 4},
    {quorumBps: 6000, approvalBps: 6667, minimumEligible: 3, minimumYes: 2},
  ),
});

export type GovernanceChamberTally = {
  eligible: number;
  turnout: number;
  quorumRequired: number;
  yes: number;
  no: number;
  abstain: number;
  approvalRequired: number;
  quorumReached: boolean;
  approved: boolean;
};

export type GovernanceQuorumCertificate = {
  format: typeof AGORA_GOVERNANCE_CERTIFICATE_FORMAT;
  protocolVersion: typeof AGORA_GOVERNANCE_PROTOCOL_VERSION;
  decisionDigest: `sha256:${string}`;
  networkId: string;
  scope: GovernanceScope;
  decisionClass: GovernanceDecisionClass;
  sequence: number;
  baseCheckpointId: `sha256:${string}`;
  proposalSha256: `sha256:${string}`;
  closedAt: number;
  outcome: "approved" | "rejected" | "no-quorum" | "tied";
  chambers: Readonly<Record<GovernanceChamber, GovernanceChamberTally | null>>;
  ballotsSha256: `sha256:${string}`;
  ballots: readonly GovernanceBallot[];
};

export type GovernanceSignatureVerifier = (input: {
  keyId: string;
  signature: string;
  message: Uint8Array;
}) => boolean | Promise<boolean>;

export type GovernanceNodeMandateVerifier = (input: {
  nodeId: string;
  mandateDecisionDigest: string;
  federationDecisionDigest: string;
}) => boolean | Promise<boolean>;

export class GovernanceProtocolError extends Error {
  constructor(message: string) {
    super(`Invalid AgoràNode governance material: ${message}`);
    this.name = "GovernanceProtocolError";
  }
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const MAX_VOTERS_PER_CHAMBER = 1_000_000;
const MIN_VOTING_WINDOW_MS = 60 * 60 * 1000;
const MAX_VOTING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const plainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new GovernanceProtocolError(`${label} has unknown or missing fields`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new GovernanceProtocolError("canonical numbers must be safe integers");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!plainObject(value)) throw new GovernanceProtocolError("canonical value is not JSON");
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

async function sha256Canonical(value: unknown): Promise<`sha256:${string}`> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function parseElectorate(value: unknown, chamber: GovernanceChamber): GovernanceElectorate {
  if (!plainObject(value)) throw new GovernanceProtocolError(`${chamber} electorate is not an object`);
  exactKeys(value, ["snapshotId", "actors"], `${chamber} electorate`);
  if (typeof value.snapshotId !== "string" || !DIGEST.test(value.snapshotId)) throw new GovernanceProtocolError(`${chamber} electorate snapshot is invalid`);
  if (!Array.isArray(value.actors) || value.actors.length > MAX_VOTERS_PER_CHAMBER) throw new GovernanceProtocolError(`${chamber} electorate size is invalid`);
  const actors: GovernanceElector[] = [];
  let previous: string | null = null;
  for (const candidate of value.actors) {
    if (!plainObject(candidate)) throw new GovernanceProtocolError(`${chamber} elector is not an object`);
    exactKeys(candidate, ["id", "keyId"], `${chamber} elector`);
    if (typeof candidate.id !== "string" || !IDENTIFIER.test(candidate.id)) throw new GovernanceProtocolError(`${chamber} elector ID is invalid`);
    if (typeof candidate.keyId !== "string" || !DIGEST.test(candidate.keyId)) throw new GovernanceProtocolError(`${chamber} elector key is invalid`);
    if (previous !== null && previous >= candidate.id) throw new GovernanceProtocolError(`${chamber} electors must be unique and sorted`);
    previous = candidate.id;
    actors.push({id: candidate.id, keyId: candidate.keyId as `sha256:${string}`});
  }
  return {snapshotId: value.snapshotId as `sha256:${string}`, actors};
}

export function parseGovernanceDecisionEnvelope(value: unknown): GovernanceDecisionEnvelope {
  if (!plainObject(value)) throw new GovernanceProtocolError("decision envelope is not an object");
  exactKeys(value, ["format", "protocolVersion", "networkId", "scope", "decisionClass", "sequence", "baseCheckpointId", "proposalSha256", "proposalPath", "opensAt", "closesAt", "appealClosesAt", "electorates"], "decision envelope");
  if (value.format !== AGORA_GOVERNANCE_DECISION_FORMAT || value.protocolVersion !== AGORA_GOVERNANCE_PROTOCOL_VERSION) throw new GovernanceProtocolError("decision format is unsupported");
  if (typeof value.networkId !== "string" || !IDENTIFIER.test(value.networkId)) throw new GovernanceProtocolError("network ID is invalid");
  if (!plainObject(value.scope)) throw new GovernanceProtocolError("scope is invalid");
  exactKeys(value.scope, ["kind", "id"], "scope");
  if (!['instance', 'federation'].includes(String(value.scope.kind)) || typeof value.scope.id !== "string" || !IDENTIFIER.test(value.scope.id)) throw new GovernanceProtocolError("scope is invalid");
  if (typeof value.decisionClass !== "string" || !GOVERNANCE_DECISION_CLASSES.includes(value.decisionClass as GovernanceDecisionClass)) throw new GovernanceProtocolError("decision class is invalid");
  const decisionClass = value.decisionClass as GovernanceDecisionClass;
  const decisionRule = GOVERNANCE_DECISION_RULES[decisionClass];
  if (value.scope.kind !== decisionRule.scope) throw new GovernanceProtocolError("decision class does not match scope");
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1) throw new GovernanceProtocolError("sequence is invalid");
  if (typeof value.baseCheckpointId !== "string" || !DIGEST.test(value.baseCheckpointId) || typeof value.proposalSha256 !== "string" || !DIGEST.test(value.proposalSha256)) throw new GovernanceProtocolError("decision digest reference is invalid");
  if (typeof value.proposalPath !== "string" || value.proposalPath.length > 500 || !value.proposalPath.startsWith("/") || value.proposalPath.startsWith("//") || /[\\\r\n]/.test(value.proposalPath)) throw new GovernanceProtocolError("proposal path must be same-origin");
  for (const field of ["opensAt", "closesAt", "appealClosesAt"] as const) if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0) throw new GovernanceProtocolError(`${field} is invalid`);
  const opensAt = Number(value.opensAt), closesAt = Number(value.closesAt), appealClosesAt = Number(value.appealClosesAt);
  if (closesAt - opensAt < MIN_VOTING_WINDOW_MS || closesAt - opensAt > MAX_VOTING_WINDOW_MS) throw new GovernanceProtocolError("voting window is outside protocol limits");
  if (appealClosesAt < closesAt || appealClosesAt - closesAt > MAX_APPEAL_WINDOW_MS) throw new GovernanceProtocolError("appeal window is outside protocol limits");
  if (!plainObject(value.electorates)) throw new GovernanceProtocolError("electorates are invalid");
  exactKeys(value.electorates, ["members", "nodes"], "electorates");
  const members = parseElectorate(value.electorates.members, "members");
  const nodes = value.electorates.nodes === null ? null : parseElectorate(value.electorates.nodes, "nodes");
  if ((decisionRule.chambers.nodes === null) !== (nodes === null)) throw new GovernanceProtocolError("node chamber does not match decision class");
  if (members.actors.length < decisionRule.chambers.members!.minimumEligible || (nodes && nodes.actors.length < decisionRule.chambers.nodes!.minimumEligible)) throw new GovernanceProtocolError("electorate is below the constitutional minimum");
  return {
    format: AGORA_GOVERNANCE_DECISION_FORMAT,
    protocolVersion: AGORA_GOVERNANCE_PROTOCOL_VERSION,
    networkId: value.networkId,
    scope: {kind: value.scope.kind as GovernanceScope["kind"], id: value.scope.id},
    decisionClass,
    sequence: Number(value.sequence),
    baseCheckpointId: value.baseCheckpointId as `sha256:${string}`,
    proposalSha256: value.proposalSha256 as `sha256:${string}`,
    proposalPath: value.proposalPath,
    opensAt,
    closesAt,
    appealClosesAt,
    electorates: {members, nodes},
  };
}

function parseGovernanceBallot(value: unknown): GovernanceBallot {
  if (!plainObject(value)) throw new GovernanceProtocolError("ballot is not an object");
  exactKeys(value, ["format", "protocolVersion", "decisionDigest", "chamber", "voterId", "choice", "keyId", "mandateDecisionDigest", "signature"], "ballot");
  if (value.format !== AGORA_GOVERNANCE_BALLOT_FORMAT || value.protocolVersion !== AGORA_GOVERNANCE_PROTOCOL_VERSION) throw new GovernanceProtocolError("ballot format is unsupported");
  if (typeof value.decisionDigest !== "string" || !DIGEST.test(value.decisionDigest) || typeof value.keyId !== "string" || !DIGEST.test(value.keyId)) throw new GovernanceProtocolError("ballot digest reference is invalid");
  if (!['members', 'nodes'].includes(String(value.chamber)) || typeof value.voterId !== "string" || !IDENTIFIER.test(value.voterId) || !['yes', 'no', 'abstain'].includes(String(value.choice))) throw new GovernanceProtocolError("ballot choice or voter is invalid");
  const chamber = value.chamber as GovernanceChamber;
  if (chamber === "nodes") {
    if (typeof value.mandateDecisionDigest !== "string" || !DIGEST.test(value.mandateDecisionDigest)) throw new GovernanceProtocolError("node ballot has no valid local mandate");
  } else if (value.mandateDecisionDigest !== null) throw new GovernanceProtocolError("member ballot cannot carry a node mandate");
  if (typeof value.signature !== "string" || !SIGNATURE.test(value.signature)) throw new GovernanceProtocolError("ballot signature encoding is invalid");
  return value as unknown as GovernanceBallot;
}

/** Bytes that an elector signs with the key frozen in the electorate snapshot. */
export function governanceBallotMessage(ballot: Omit<GovernanceBallot, "signature"> | GovernanceBallot): Uint8Array {
  const {signature: _signature, ...unsigned} = ballot as GovernanceBallot;
  return new TextEncoder().encode(`AGORANODE-GOVERNANCE-BALLOT-V1\0${canonicalJson(unsigned)}`);
}

/** Deterministic electorate digest used by a decision envelope. */
export async function governanceElectorateSnapshotId(chamber: GovernanceChamber, actors: readonly GovernanceElector[]): Promise<`sha256:${string}`> {
  return sha256Canonical({format: "org.agoranode.governance-electorate.v1", protocolVersion: 1, chamber, actors});
}

/** Deterministic digest to bind ballots, checkpoints and independent verifiers. */
export async function governanceDecisionDigest(envelope: GovernanceDecisionEnvelope): Promise<`sha256:${string}`> {
  return sha256Canonical(parseGovernanceDecisionEnvelope(envelope));
}

function requiredCount(total: number, basisPoints: number) {
  return Math.ceil(total * basisPoints / 10_000);
}

function tallyChamber(eligible: number, choices: readonly GovernanceChoice[], chamberRule: GovernanceChamberRule): GovernanceChamberTally {
  const yes = choices.filter(choice => choice === "yes").length;
  const no = choices.filter(choice => choice === "no").length;
  const abstain = choices.length - yes - no;
  const turnout = choices.length;
  const quorumRequired = requiredCount(eligible, chamberRule.quorumBps);
  const approvalRequired = Math.max(chamberRule.minimumYes, requiredCount(yes + no, chamberRule.approvalBps));
  const quorumReached = turnout >= quorumRequired;
  return {eligible, turnout, quorumRequired, yes, no, abstain, approvalRequired, quorumReached, approved: quorumReached && yes >= approvalRequired};
}

/**
 * Verify all final ballots and derive a reproducible quorum certificate.
 * `verifySignature` must perform real Ed25519 verification against the key ID;
 * node ballots additionally require verification of the cited local mandate.
 */
export async function evaluateGovernanceDecision(
  envelopeValue: unknown,
  ballotValues: readonly unknown[],
  options: {
    now: number;
    verifySignature: GovernanceSignatureVerifier;
    verifyNodeMandate?: GovernanceNodeMandateVerifier;
  },
): Promise<GovernanceQuorumCertificate> {
  const envelope = parseGovernanceDecisionEnvelope(envelopeValue);
  if (!Number.isSafeInteger(options.now) || options.now < envelope.closesAt) throw new GovernanceProtocolError("decision is not closed");
  const decisionDigest = await governanceDecisionDigest(envelope);
  for (const chamber of ["members", "nodes"] as const) {
    const electorate = envelope.electorates[chamber];
    if (electorate && await governanceElectorateSnapshotId(chamber, electorate.actors) !== electorate.snapshotId) throw new GovernanceProtocolError(`${chamber} electorate digest does not match its actors`);
  }
  const maximumBallots = envelope.electorates.members.actors.length + (envelope.electorates.nodes?.actors.length ?? 0);
  if (!Array.isArray(ballotValues) || ballotValues.length > maximumBallots) throw new GovernanceProtocolError("ballot set exceeds the frozen electorate");
  const ballots = ballotValues.map(parseGovernanceBallot).sort((left, right) => left.chamber < right.chamber ? -1 : left.chamber > right.chamber ? 1 : left.voterId < right.voterId ? -1 : left.voterId > right.voterId ? 1 : 0);
  const seen = new Set<string>();
  for (const ballot of ballots) {
    if (ballot.decisionDigest !== decisionDigest) throw new GovernanceProtocolError("ballot belongs to a different decision");
    const electorate = envelope.electorates[ballot.chamber];
    if (!electorate) throw new GovernanceProtocolError("ballot targets a chamber absent from this decision");
    const elector = electorate.actors.find(actor => actor.id === ballot.voterId);
    if (!elector || elector.keyId !== ballot.keyId) throw new GovernanceProtocolError("ballot voter is not in the frozen electorate");
    const unique = `${ballot.chamber}:${ballot.voterId}`;
    if (seen.has(unique)) throw new GovernanceProtocolError("an elector appears more than once");
    seen.add(unique);
    let signatureValid = false;
    try { signatureValid = await options.verifySignature({keyId: ballot.keyId, signature: ballot.signature, message: governanceBallotMessage(ballot)}); } catch { /* fail closed below */ }
    if (!signatureValid) throw new GovernanceProtocolError("ballot signature verification failed");
    if (ballot.chamber === "nodes") {
      let mandateValid = false;
      try { mandateValid = Boolean(options.verifyNodeMandate && await options.verifyNodeMandate({nodeId: ballot.voterId, mandateDecisionDigest: ballot.mandateDecisionDigest!, federationDecisionDigest: decisionDigest})); } catch { /* fail closed below */ }
      if (!mandateValid) throw new GovernanceProtocolError("node ballot is not backed by a verified local mandate");
    }
  }
  const decisionRule = GOVERNANCE_DECISION_RULES[envelope.decisionClass];
  const members = tallyChamber(envelope.electorates.members.actors.length, ballots.filter(ballot => ballot.chamber === "members").map(ballot => ballot.choice), decisionRule.chambers.members!);
  const nodes = envelope.electorates.nodes ? tallyChamber(envelope.electorates.nodes.actors.length, ballots.filter(ballot => ballot.chamber === "nodes").map(ballot => ballot.choice), decisionRule.chambers.nodes!) : null;
  const required = [members, ...(nodes ? [nodes] : [])];
  const outcome = required.some(result => !result.quorumReached)
    ? "no-quorum"
    : required.some(result => result.yes === result.no)
      ? "tied"
      : required.every(result => result.approved) ? "approved" : "rejected";
  return {
    format: AGORA_GOVERNANCE_CERTIFICATE_FORMAT,
    protocolVersion: AGORA_GOVERNANCE_PROTOCOL_VERSION,
    decisionDigest,
    networkId: envelope.networkId,
    scope: envelope.scope,
    decisionClass: envelope.decisionClass,
    sequence: envelope.sequence,
    baseCheckpointId: envelope.baseCheckpointId,
    proposalSha256: envelope.proposalSha256,
    closedAt: envelope.closesAt,
    outcome,
    chambers: {members, nodes},
    ballotsSha256: await sha256Canonical(ballots),
    ballots,
  };
}

export const PR2_MEMBERSHIP_STATES = ["pending", "active", "suspended", "left", "revoked", "expired"] as const;
export const PR3_MANDATE_STATES = ["nominated", "candidate", "elected", "active", "withdrawn", "recalled", "resigned", "expired"] as const;
export type Pr2MembershipState = (typeof PR2_MEMBERSHIP_STATES)[number];
export type Pr3MandateState = (typeof PR3_MANDATE_STATES)[number];

/** Public pseudonymous proof only; PR1 account, email and social evidence stay private. */
export type Pr2MembershipProof = {
  format: typeof AGORA_PR2_MEMBERSHIP_FORMAT;
  protocolVersion: typeof AGORA_GOVERNANCE_PROTOCOL_VERSION;
  networkId: string;
  membershipId: `sha256:${string}`;
  actorId: string;
  nodeId: string;
  state: Pr2MembershipState;
  admittedByDecisionDigest: `sha256:${string}` | null;
  validFrom: number;
  validUntil: number | null;
};

/** One immutable state transition in the append-only history of a PR3 mandate. */
export type Pr3MandateRecord = {
  format: typeof AGORA_PR3_MANDATE_RECORD_FORMAT;
  protocolVersion: typeof AGORA_GOVERNANCE_PROTOCOL_VERSION;
  networkId: string;
  mandateId: `sha256:${string}`;
  actorId: string;
  federationId: string;
  sourceNodeId: string;
  sourceMembershipId: `sha256:${string}`;
  candidacySha256: `sha256:${string}`;
  state: Pr3MandateState;
  transitionAt: number;
  previousRecordDigest: `sha256:${string}` | null;
  electionDecisionDigest: `sha256:${string}` | null;
  startsAt: number | null;
  expiresAt: number | null;
  evidenceSha256: `sha256:${string}`;
};

export type GovernanceActorConsentVerifier = (input: {
  actorId: string;
  mandateId: string;
  state: "candidate" | "active" | "withdrawn" | "resigned";
  evidenceSha256: string;
}) => boolean | Promise<boolean>;

export function parsePr2MembershipProof(value: unknown): Pr2MembershipProof {
  if (!plainObject(value)) throw new GovernanceProtocolError("PR2 membership proof is not an object");
  exactKeys(value, ["format", "protocolVersion", "networkId", "membershipId", "actorId", "nodeId", "state", "admittedByDecisionDigest", "validFrom", "validUntil"], "PR2 membership proof");
  if (value.format !== AGORA_PR2_MEMBERSHIP_FORMAT || value.protocolVersion !== AGORA_GOVERNANCE_PROTOCOL_VERSION) throw new GovernanceProtocolError("PR2 membership format is unsupported");
  if (typeof value.networkId !== "string" || !IDENTIFIER.test(value.networkId) || typeof value.membershipId !== "string" || !DIGEST.test(value.membershipId) || typeof value.actorId !== "string" || !IDENTIFIER.test(value.actorId) || typeof value.nodeId !== "string" || !IDENTIFIER.test(value.nodeId)) throw new GovernanceProtocolError("PR2 membership identity is invalid");
  if (typeof value.state !== "string" || !PR2_MEMBERSHIP_STATES.includes(value.state as Pr2MembershipState)) throw new GovernanceProtocolError("PR2 membership state is invalid");
  if (value.admittedByDecisionDigest !== null && (typeof value.admittedByDecisionDigest !== "string" || !DIGEST.test(value.admittedByDecisionDigest))) throw new GovernanceProtocolError("PR2 admission decision is invalid");
  if (value.state === "active" && value.admittedByDecisionDigest === null) throw new GovernanceProtocolError("active PR2 membership has no admission decision");
  if (!Number.isSafeInteger(value.validFrom) || Number(value.validFrom) < 0 || (value.validUntil !== null && (!Number.isSafeInteger(value.validUntil) || Number(value.validUntil) <= Number(value.validFrom)))) throw new GovernanceProtocolError("PR2 membership validity is invalid");
  return value as unknown as Pr2MembershipProof;
}

export function isPr3EligiblePr2(value: unknown, at: number, expectedNetworkId: string): value is Pr2MembershipProof {
  if (!Number.isSafeInteger(at) || at < 0 || !IDENTIFIER.test(expectedNetworkId)) return false;
  try {
    const membership = parsePr2MembershipProof(value);
    return membership.networkId === expectedNetworkId && membership.state === "active" && membership.validFrom <= at && (membership.validUntil === null || at < membership.validUntil);
  } catch {
    return false;
  }
}

export function parsePr3MandateRecord(value: unknown): Pr3MandateRecord {
  if (!plainObject(value)) throw new GovernanceProtocolError("PR3 mandate record is not an object");
  exactKeys(value, ["format", "protocolVersion", "networkId", "mandateId", "actorId", "federationId", "sourceNodeId", "sourceMembershipId", "candidacySha256", "state", "transitionAt", "previousRecordDigest", "electionDecisionDigest", "startsAt", "expiresAt", "evidenceSha256"], "PR3 mandate record");
  if (value.format !== AGORA_PR3_MANDATE_RECORD_FORMAT || value.protocolVersion !== AGORA_GOVERNANCE_PROTOCOL_VERSION) throw new GovernanceProtocolError("PR3 mandate format is unsupported");
  if (typeof value.networkId !== "string" || !IDENTIFIER.test(value.networkId) || typeof value.actorId !== "string" || !IDENTIFIER.test(value.actorId) || typeof value.federationId !== "string" || !IDENTIFIER.test(value.federationId) || typeof value.sourceNodeId !== "string" || !IDENTIFIER.test(value.sourceNodeId)) throw new GovernanceProtocolError("PR3 mandate identity is invalid");
  for (const field of ["mandateId", "sourceMembershipId", "candidacySha256", "evidenceSha256"] as const) if (typeof value[field] !== "string" || !DIGEST.test(value[field])) throw new GovernanceProtocolError(`PR3 ${field} is invalid`);
  for (const field of ["previousRecordDigest", "electionDecisionDigest"] as const) if (value[field] !== null && (typeof value[field] !== "string" || !DIGEST.test(value[field]))) throw new GovernanceProtocolError(`PR3 ${field} is invalid`);
  if (typeof value.state !== "string" || !PR3_MANDATE_STATES.includes(value.state as Pr3MandateState) || !Number.isSafeInteger(value.transitionAt) || Number(value.transitionAt) < 0) throw new GovernanceProtocolError("PR3 state or transition time is invalid");
  for (const field of ["startsAt", "expiresAt"] as const) if (value[field] !== null && (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0)) throw new GovernanceProtocolError(`PR3 ${field} is invalid`);
  const preElection = ["nominated", "candidate", "withdrawn"].includes(value.state);
  if (preElection) {
    if (value.electionDecisionDigest !== null || value.startsAt !== null || value.expiresAt !== null) throw new GovernanceProtocolError("unelected PR3 record carries a mandate");
  } else {
    if (value.electionDecisionDigest === null || value.startsAt === null || value.expiresAt === null || Number(value.expiresAt) <= Number(value.startsAt) || Number(value.expiresAt) - Number(value.startsAt) > AGORA_PR3_MAX_MANDATE_MS) throw new GovernanceProtocolError("PR3 elected mandate dates are invalid");
  }
  return value as unknown as Pr3MandateRecord;
}

export async function pr3MandateRecordDigest(value: Pr3MandateRecord): Promise<`sha256:${string}`> {
  return sha256Canonical(parsePr3MandateRecord(value));
}

function samePr3Identity(left: Pr3MandateRecord, right: Pr3MandateRecord) {
  return left.networkId === right.networkId && left.mandateId === right.mandateId && left.actorId === right.actorId && left.federationId === right.federationId && left.sourceNodeId === right.sourceNodeId && left.sourceMembershipId === right.sourceMembershipId && left.candidacySha256 === right.candidacySha256;
}

function approvedPr3Certificate(certificate: GovernanceQuorumCertificate | undefined, next: Pr3MandateRecord, decisionClass: "pr3-election" | "pr3-recall", proposalSha256: string) {
  return Boolean(certificate && certificate.outcome === "approved" && certificate.decisionClass === decisionClass && certificate.networkId === next.networkId && certificate.scope.kind === "federation" && certificate.scope.id === next.federationId && certificate.proposalSha256 === proposalSha256);
}

/**
 * Validate one append-only PR3 state transition.  Authorization certificates
 * must already have been reproduced by evaluateGovernanceDecision; this helper
 * binds them to the candidate and federation but does not re-verify ballots.
 */
export async function validatePr3MandateTransition(
  previousValue: unknown | null,
  nextValue: unknown,
  options: {
    now: number;
    sourceMembership: unknown;
    authorizationCertificate?: GovernanceQuorumCertificate;
    verifyActorConsent?: GovernanceActorConsentVerifier;
  },
): Promise<Pr3MandateRecord> {
  if (!Number.isSafeInteger(options.now) || options.now < 0) throw new GovernanceProtocolError("PR3 validation time is invalid");
  const next = parsePr3MandateRecord(nextValue);
  if (next.transitionAt > options.now) throw new GovernanceProtocolError("PR3 transition is in the future");
  const membership = parsePr2MembershipProof(options.sourceMembership);
  if (membership.networkId !== next.networkId || membership.membershipId !== next.sourceMembershipId || membership.actorId !== next.actorId || membership.nodeId !== next.sourceNodeId) throw new GovernanceProtocolError("PR3 source membership does not match the candidate");
  const previous = previousValue === null ? null : parsePr3MandateRecord(previousValue);
  if (previous === null) {
    if (next.state !== "nominated" || next.previousRecordDigest !== null) throw new GovernanceProtocolError("first PR3 state must be a nomination");
    if (!isPr3EligiblePr2(membership, next.transitionAt, next.networkId)) throw new GovernanceProtocolError("PR3 nominee is not an active PR2 member");
    return next;
  }
  if (!samePr3Identity(previous, next)) throw new GovernanceProtocolError("PR3 mandate identity changed across transitions");
  if (next.previousRecordDigest !== await pr3MandateRecordDigest(previous)) throw new GovernanceProtocolError("PR3 transition does not extend the previous record");
  if (next.transitionAt <= previous.transitionAt) throw new GovernanceProtocolError("PR3 transition time is not monotonic");
  const transitions: Readonly<Record<Pr3MandateState, readonly Pr3MandateState[]>> = {
    nominated: ["candidate", "withdrawn"],
    candidate: ["elected", "withdrawn"],
    elected: ["active", "recalled", "resigned", "expired"],
    active: ["recalled", "resigned", "expired"],
    withdrawn: [], recalled: [], resigned: [], expired: [],
  };
  if (!transitions[previous.state].includes(next.state)) throw new GovernanceProtocolError("PR3 state transition is not allowed");
  if (["candidate", "elected", "active"].includes(next.state) && !isPr3EligiblePr2(membership, next.transitionAt, next.networkId)) throw new GovernanceProtocolError("PR3 candidate or mandate holder is no longer an active PR2 member");
  if (next.state === "elected") {
    const certificate = options.authorizationCertificate;
    if (!approvedPr3Certificate(certificate, next, "pr3-election", next.candidacySha256) || next.electionDecisionDigest !== certificate!.decisionDigest || next.startsAt! < certificate!.closedAt || next.transitionAt < certificate!.closedAt) throw new GovernanceProtocolError("PR3 election certificate or mandate term is invalid");
  } else if (previous.electionDecisionDigest !== next.electionDecisionDigest || previous.startsAt !== next.startsAt || previous.expiresAt !== next.expiresAt) {
    throw new GovernanceProtocolError("PR3 election or term changed after election");
  }
  const consentState = ["candidate", "active", "withdrawn", "resigned"].includes(next.state) ? next.state as "candidate" | "active" | "withdrawn" | "resigned" : null;
  if (consentState) {
    if (consentState === "candidate" && next.evidenceSha256 !== next.candidacySha256) throw new GovernanceProtocolError("PR3 candidate consent does not bind the candidacy");
    let consent = false;
    try { consent = Boolean(options.verifyActorConsent && await options.verifyActorConsent({actorId: next.actorId, mandateId: next.mandateId, state: consentState, evidenceSha256: next.evidenceSha256})); } catch { /* fail closed below */ }
    if (!consent) throw new GovernanceProtocolError("PR3 transition lacks verified candidate consent");
  }
  if (next.state === "active" && (next.transitionAt < next.startsAt! || next.transitionAt >= next.expiresAt!)) throw new GovernanceProtocolError("PR3 mandate cannot activate outside its term");
  if (next.state === "recalled" && !approvedPr3Certificate(options.authorizationCertificate, next, "pr3-recall", next.evidenceSha256)) throw new GovernanceProtocolError("PR3 recall certificate is invalid");
  if (["recalled", "resigned"].includes(next.state) && next.transitionAt >= next.expiresAt!) throw new GovernanceProtocolError("PR3 mandate already expired before its termination");
  if (next.state === "expired" && next.transitionAt < next.expiresAt!) throw new GovernanceProtocolError("PR3 mandate has not expired");
  return next;
}
