import { RoomManager } from "../RoomManager";

import { RoomOperation } from "./RoomOperation";
import { RoomOperationInterface } from "./RoomOperationInterface";


/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class RepairOperation extends RoomOperation{
    

    constructor(manager: RoomManager, entry: RoomOperationInterface) {
        super(manager,entry);
        this.type = "RepairOperation";
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */

    public run() {
        if(this.firstRun){
            this.onfirstRun();
        }
        this.didRun=true;
        this.pause = 100;
        console.log("RUNNING REPAIR OP: AT " + String(Game.time));
        const r: Room = Game.rooms[this.roomName];
        const constrSites = r.find(FIND_STRUCTURES).filter( str => str.hits < str.hitsMax);
        if(constrSites.length > 0) {
            const repairers: Creep[] = [];
            for(const key in Game.creeps) {
                if(Game.creeps[key].memory.role === "Repairer" && Game.creeps[key].room.name === r.name) {
                    repairers.push(Game.creeps[key]);
                }
            }
            const currentRepairers = repairers.length;

            const inSpawningRepairers = this.manager.data.toSpawnList.filter(
                (entry) => entry.memory.role === "Repairer"
            ).length;

            const numToSpawn: number = Math.max(0, Math.ceil(constrSites.length/10));
            if(numToSpawn > currentRepairers + inSpawningRepairers){
                for(let j=0; j< numToSpawn - (currentRepairers + inSpawningRepairers); j++){
                    this.manager.spawnmgr.enque({
                        memory: {role: "Repairer"},
                        name: this.manager.roomName +"_"+this.type+"_",
                        pause: 0,
                        body: undefined,
                        priority: 50,
                        rebuild: false});
                }
            }
        }
    }


}