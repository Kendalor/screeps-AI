import { OperationsManager } from "empire/OperationsManager";
import { RoomOperation, RoomOperationProto } from "../Operations/RoomOperation";


/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export default class RepairOperation extends RoomOperation{
    

    constructor(name: string, manager: OperationsManager, entry: RoomOperationProto) {
        super(name, manager,entry);
        this.type =OPERATION.REPAIR;
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */

    public run() {
        super.run();
        this.pause = 100;

        this.validateCreeps();

        
        const r: Room = this.room;
        if(r != null){     
            const constrSites = r.find(FIND_STRUCTURES).filter( str => str.hits < str.hitsMax * 0.6);

            if(constrSites.length > 0) {


                const numToSpawn: number = Math.max(0, Math.ceil(constrSites.length/10));
                if(numToSpawn > this.data.creeps.length){
                    for(let j=0; j< numToSpawn - (this.data.creeps.length); j++){
                        const name = this.manager.empire.spawnMgr.enque({
                            room: r.name,
                            memory: {role: "Repairer", op: this.name},
                            pause: 0,
                            body: undefined,
                            priority: 40,
                            rebuild: false});
                        this.data.creeps.push(name);
                    }
                }
            }
        }
    }


}