import { RoomManager } from "../RoomManager";

import { RoomOperation } from "./RoomOperation";
import { RoomOperationInterface } from "./RoomOperationInterface";


/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class BuildOperation extends RoomOperation{
    

    constructor(manager: RoomManager, entry: RoomOperationInterface) {
        super(manager,entry);
        this.type = "BuildOperation";
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */

    public run() {
        if(this.firstRun){
            this.onfirstRun();
        }
        this.didRun=true;
        const r: Room = Game.rooms[this.roomName];
        const constrSites = r.find(FIND_CONSTRUCTION_SITES);
        if(constrSites.length > 0) {
            const builders: Creep[] = [];
            for(const key in Game.creeps) {
                if(Game.creeps[key].memory.role === "Builder" && Game.creeps[key].room.name === r.name) {
                    builders.push(Game.creeps[key]);
                }
            }
            const currentBuilders = builders.length;

            const inSpawningBuilders = this.manager.data.toSpawnList.filter(
                (entry) => entry.memory.role === "Builder"
            ).length;

            const numToSpawn: number = Math.max(0, Math.ceil(constrSites.length/5));
            if(numToSpawn > currentBuilders + inSpawningBuilders){
                for(let j=0; j< numToSpawn - (currentBuilders + inSpawningBuilders); j++){
                    this.manager.spawnmgr.enque({
                        memory: {role: "Builder"},
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