import { RoomManager } from "../RoomManager";

import { RoomOperation } from "./RoomOperation";
import { RoomOperationInterface } from "./RoomOperationInterface";
import { CreepRole } from "manager/Creeps/roles/CreepRole";






/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class UpgradeOperation extends RoomOperation{
    

    constructor(manager: RoomManager, entry: RoomOperationInterface) {
        super(manager,entry);
        this.type = "UpgradeOperation";
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */
    public onfirstRun(){
        console.log("Running super.onfirstRun()");
        super.onfirstRun();        
    }


    public init() {
        // TODO
    }
    public run() {
        console.log("MinerOP OP Enqueue Creeps !");
        if(this.firstRun){
            console.log("First run Detected, running onFirstRun()");
            this.onfirstRun();
        }
        this.didRun=true;
        const r: Room = Game.rooms[this.roomName];
        if( r.storage != null ){

            const upgraders: Creep[] = [];
            for(const key in Game.creeps){
                if(Game.creeps[key].memory.role === "Upgrader" && Game.creeps[key].room.name === r.name) {
                    upgraders.push(Game.creeps[key]);
                }
            }
            const currentUpgraders = upgraders.length;

            const inSpawningUpgraders = this.manager.data.toSpawnList.filter(
                (entry) => entry.memory.role === "Upgrader"
            ).length;

            const numToSpawn: number = Math.max(0, Math.floor((r.storage.store.energy - 100000)/40000));

            if(numToSpawn > currentUpgraders + inSpawningUpgraders){
                for(let j=0; j< numToSpawn - (currentUpgraders + inSpawningUpgraders); j++){
                    this.manager.spawnmgr.enque({
                        memory: {role: "Upgrader"},
                        name: this.manager.roomName +"_"+this.type+"_",
                        pause: 0,
                        body: undefined,
                        priority: 50,
                        rebuild: false});
                }
            }
        }

            
    }

    public destroy() {
        // TODO
    }

    public onlastRun() {
        // TODO
    }

}