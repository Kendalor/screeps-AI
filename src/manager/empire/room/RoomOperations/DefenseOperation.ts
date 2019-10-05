import { RoomManager } from "../RoomManager";

import { RoomOperation } from "./RoomOperation";
import { RoomOperationInterface } from "./RoomOperationInterface";





/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class DefenseOperation extends RoomOperation{
    

    constructor(manager: RoomManager, entry: RoomOperationInterface) {
        super(manager,entry);
        this.type = "DefenseOperation";
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
        console.log("HaulerrOP OP Enqueue Creeps !");
        if(this.firstRun){
            console.log("First run Detected, running onFirstRun()");
            this.onfirstRun();
        }
        const r: Room = Game.rooms[this.roomName];
        if(r != null){
            const enemies: Creep[] = r.find(FIND_HOSTILE_CREEPS);
            if(enemies.length > 0) {
                const towers: StructureTower[] = r.find(FIND_MY_STRUCTURES).filter( str => str.structureType === STRUCTURE_TOWER) as StructureTower[];
                if (towers.length > 0 ){
                    for( const t of towers){
                        const a: Creep | null = t.pos.findClosestByRange(enemies);
                        if( a!= null){
                            t.attack(a); 
                        }
                    } 
                } else {
                    if( r.controller != null ) {
                        r.controller.activateSafeMode();
                    }
                }
            }
        }
        this.didRun=true;


        // TODO
    }

    public destroy() {
        // TODO
    }

    public onlastRun() {
        // TODO
    }

}