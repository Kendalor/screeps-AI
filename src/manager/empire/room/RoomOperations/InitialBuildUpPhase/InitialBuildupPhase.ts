import { RoomManager } from "../../RoomManager";
import { RoomOperation } from "../RoomOperation";
import { RoomOperationInterface } from "../RoomOperationInterface";





/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class InitialBuildUpPhase extends RoomOperation{
    

    constructor(manager: RoomManager, entry: RoomOperationInterface) {
        super(manager,entry);
        this.type = "InitialBuildUpPhase";
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */
    public onfirstRun(){
        super.onfirstRun();
        if(Game.rooms[this.roomName] !== undefined ){
            // SPAWN CREEPS HERE 
            const r: Room =this.manager.room;
            const numSources= r.find(FIND_SOURCES).length
            for(let i=0; i<numSources *3; i++){
                this.manager.spawnmgr.enque({body: [WORK,WORK,MOVE,CARRY] ,
                    memory: {role: "maintenance"},
                    name: this.manager.roomName +"_"+this.type+"_"+i,
                    pause: 0,
                    priority: 100,
                    rebuild: true});
            }
            
        }
        
    }


    public init() {
        // TODO
    }
    public run() {
        if(this.firstRun){
            this.onfirstRun();
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