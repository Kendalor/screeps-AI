import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "./OperationMemory";
import { RoomOperation } from "./RoomOperation";


export class UpgradeOperation extends RoomOperation{
    

    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.type = "UpgradeOperation";
    }

    public run() {
        super.run();


        const r: Room = this.room;
        if(r != null){
            if( r.storage != null ){

                this.validateCreeps();
                const currentUpgraders = this.data.creeps.length;



                const numToSpawn: number = Math.min(4, Math.max(0, Math.floor((r.storage.store.energy - 100000)/40000)));

                if(numToSpawn > currentUpgraders){
                    for(let j=currentUpgraders; j< numToSpawn ; j++){
                        const name = this.manager.empire.spawnMgr.enque({
                            room: r.name,
                            memory: {role: "Upgrader"},
                            pause: 0,
                            body: undefined,
                            priority: 50,
                            rebuild: false});
                        this.data.creeps.push(name);
                    }
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