import type {Connection} from './database';

/**
 * Authoritative PR2 identity check used by forum, issues and editorial APIs.
 * A connected account alone (PR1), hosting a server, or a client role string
 * confers no voting or posting rights. Agorà PR2 acts as PR3 in the platform.
 *
 * All attestations must already have passed signature validation on enrollment.
 * Reject stale, foreign-node and revoked issuer credentials on every action.
 */
export async function verifiedNodePr2(
 db:Connection,spaceId:string,userId:string,now=Date.now(),
):Promise<boolean>{
 if(!/^[a-z][a-z0-9-]{2,47}$/.test(spaceId)||!userId||userId.length>200)return false;
 const query=await db.query(
  `SELECT 1 FROM federation_pr2_attestations a
    JOIN federation_pr2_electors e ON e.owner_key=a.owner_key
    JOIN federation_node_keys k ON k.node_id=a.source_node_id AND k.key_id=a.issuer_key_id
    WHERE e.owner_key=$1 AND e.source_node_id=$2 AND a.source_node_id=$2
      AND a.source_membership_id=e.source_membership_id
      AND (a.proof_json::jsonb->>'state')='active'
      AND (a.proof_json::jsonb->>'nodeId')=$2
      AND a.valid_from<=$3 AND a.valid_until>$3
      AND k.valid_from<=$3 AND (k.valid_until IS NULL OR k.valid_until>$3)
    LIMIT 1`,[userId,spaceId,now]);
 return query.rows.length>0;
}
export const verifiedAgoraPr3=(db:Connection,userId:string,now=Date.now())=>
 verifiedNodePr2(db,'agora',userId,now);
