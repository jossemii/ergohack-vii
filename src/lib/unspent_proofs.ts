import { type RPBox, type ReputationProof, object_type_by_rendered_value, Network } from "$lib/ReputationProof";
import { check_if_r7_is_local_addr, generate_pk_proposition, hexToUtf8, serializedToRendered, stringToRendered, stringToSerialized } from "$lib/utils";

/**
    https://api.ergoplatform.com/api/v1/docs/#operation/postApiV1BoxesUnspentSearch
*/

type RegisterValue = {
    renderedValue: string;
    serializedValue: string;
  };

type ApiBox = {
    boxId: string;
    value: string | bigint;
    assets: { tokenId: string; amount: string | bigint }[];
    ergoTree: string;
    creationHeight: number;
    additionalRegisters: {
        R4?: RegisterValue;
        R5?: RegisterValue;
        R6?: RegisterValue;
        R7?: RegisterValue;
        R8?: RegisterValue;
        R9?: RegisterValue;
    };
    index: number;
    transactionId: string;
};

export async function getUnconfirmed(explorer_uri: string, ergo: any)
{
    const wallet_pk = await ergo.get_change_address();

    try {
        const response = await fetch(explorer_uri+'/api/v1/boxes/unspent/unconfirmed/byAddress/'+wallet_pk, {
            method: 'GET'
        });

        if (response.ok) {
            const apiData = await response.json();
            console.log(apiData)
        }        
        else {
            console.error('Error al realizar la solicitud POST');
        }
    } catch (error) {
        console.error('Error al procesar la solicitud POST:', error);
    }
}

export async function updateReputationProofList(explorer_uri: string, ergo_tree_template_hash: string, ergo: any, all: boolean, search: string|null): Promise<ReputationProof[]> 
{
    try {
        let params = {
            offset: 0,
            limit: 500,
        };
        let proofs = new Map<string, ReputationProof>();
        let moreDataAvailable = true;

        const r7 = serializedToRendered(generate_pk_proposition((await ergo.get_change_address())));
        let registers = {}
        if (search) {
            const r4 = stringToRendered(search);
            registers = all ? { "R4": r4 } : {
                "R4":  r4,
                "R7":  r7
            };
        } 
        else {
            registers = all ? {} : {
                "R7":  r7
            };
    
        }

        while (moreDataAvailable) {
            const url = explorer_uri+'/api/v1/boxes/unspent/search';
            const response = await fetch(url + '?' + new URLSearchParams({
                offset: params.offset.toString(),
                limit: params.limit.toString(),
            }), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                    "ergoTreeTemplateHash": ergo_tree_template_hash,
                    "registers": registers,
                    "constants": {},
                    "assets": []
                }),
            });

            if (response.ok) {
                let json_data = await response.json();
                if (json_data.items.length == 0) {
                    moreDataAvailable = false;
                    break;
                }
                json_data.items.forEach(async (e: ApiBox) => {
                    let token_id = e.assets[0].tokenId;
                    let current_box: RPBox = {
                            box_id: e.boxId,
                            token_id: e.assets.length > 0 ? e.assets[0].tokenId : "",
                            token_amount: e.assets.length > 0 ? Number(e.assets[0].amount) : 0,
                            box: {
                                boxId: e.boxId,
                                value: e.value,
                                assets: e.assets,
                                ergoTree: e.ergoTree,
                                creationHeight: e.creationHeight,
                                additionalRegisters: Object.entries(e.additionalRegisters).reduce((acc, [key, value]) => {
                                    acc[key] = value.serializedValue;
                                    return acc;
                                }, {} as {
                                    [key: string]: string;
                                }),
                                index: e.index,
                                transactionId: e.transactionId
                            }
                        };
                    
                    if (e.additionalRegisters.R6 !== undefined && e.additionalRegisters.R5 !== undefined) {
                        current_box.object_type = object_type_by_rendered_value(e.additionalRegisters.R5.renderedValue),
                        current_box.object_value = e.additionalRegisters.R6.renderedValue;
                    }
                    let r7_value = e.additionalRegisters.R7 !== undefined ? (e.additionalRegisters.R7.renderedValue ?? "") : "";
                    let r4_value = e.additionalRegisters.R4 !== undefined ? (e.additionalRegisters.R4.renderedValue ?? "") : "";
                    let _reputation_proof: ReputationProof = proofs.has(token_id) 
                        ? proofs.get(token_id)! 
                        : {
                            current_boxes: [], 
                            token_id: token_id,
                            number_of_boxes: 0,
                            total_amount: 0,
                            network: Network.ErgoTestnet,
                            can_be_spend: await check_if_r7_is_local_addr(r7_value),
                            tag: hexToUtf8(r4_value)
                        };
                    _reputation_proof.current_boxes.push(current_box);
                    _reputation_proof.total_amount += current_box.token_amount;
                    _reputation_proof.number_of_boxes += 1;
                    proofs.set(token_id, _reputation_proof);
                });
                params.offset += params.limit;
            } 
            else {
                console.error('Error al realizar la solicitud POST');
                return [];
            }
        }
        return Array.from(proofs.values());
    } catch (error) {
        console.error('Error al procesar la solicitud POST:', error);
        return [];
    }
}