import { EmpireManager } from "./EmpireManager";
import { Operation } from "./operations/Operation";
import { OperationMemory } from "./operations/Operations/OperationMemory";
import { OP_STORAGE } from "./operations/OperationStorage";





export class OperationsManager {

	public empire: EmpireManager;
	public operations: {[id: string]: Operation} = {};
	public operationsTodo: Array<[string, Operation]> = new Array<[string, Operation]>();

    constructor(emp: EmpireManager) {
		this.empire=emp;
		if(Memory.empire == null ) {
			Memory.empire = {};
		}
		if(Memory.empire.operations== null){
			Memory.empire.operations = {};
		}

	}
	/**
	 * Start of Tick Method
	 */

	public init(): void {
		this.loadOperationList();
	}
	/**
	 * Run Method executed per tick
	 */
    public run(): void {


		let counter =0;
		
		let time =0;
		while( this.hasNextOperation()) {

			this.runNextOperation();

			counter = counter +1;
		}

		this.destroy();

		
	}
	/**
	 * End of Tick Method
	 */
	public destroy(): void {
		this.saveOperationList();
	}



	/**
	 * Run the next runable RoomOperation in the operations List with the highest Priority
	 */
    public runNextOperation(): void {

		const op = this.getNextOperation();
		if( op !== undefined ) {
			op.run();

		}
	}

	public getNextOperation(): Operation | undefined {
		if(this.hasNextOperation()){
			const temp = this.operationsTodo.pop();
			if( temp != null ){
				return temp[1];
			} else {
				return undefined;
			}
		} else {
			return undefined;
		}
	}
	public hasNextOperation(): boolean {
		return this.operationsTodo.length > 0;
	}

	/**
 	* Load Operations from Memory
	 */
    public loadOperationList(): void {
		global.logger.debug("Loading Operations: " + Object.keys(Memory.empire.operations).length);
        for(const i of Object.keys(Memory.empire.operations)) {
			if(OP_STORAGE[Memory.empire.operations[i].type] != null){
				this.operations[i]= new OP_STORAGE[Memory.empire.operations[i].type](this, Memory.empire.operations[i] as OperationMemory);
			} else {
				console.log("INVALID OPERATION WITH TYPE: " +Memory.empire.operations[i].type + " DELETED" );
				delete Memory.empire.operations[i];
			}
            
		}
		this.enque({type: "FlagListener", data: {}, priority: 100, pause: 0, lastRun: true})
		global.logger.debug("Loaded Operations List of Lengh: " + Object.keys(this.operations).length);

		this.operationsTodo = Object.entries(this.operations).filter( entry => entry[1].pause === 0 && entry[1].didRun === false).sort( (entryA,entryB) => entryA[1].priority - entryB[1].priority);
    }
    /**
     * Save Operations to Memory
     */
    public saveOperationList(): void {
		Memory.empire.operations = {};
		global.logger.debug("Saving Operations List of Lengh: " + Object.keys(this.operations).length);
        for(const key of Object.keys(this.operations)) {
            if(this.operations[key].lastRun === false){
                if(this.operations[key].pause > 0){
                    this.operations[key].pause = this.operations[key].pause -1;
				}
                Memory.empire.operations[key] = this.operations[key].toMemory() as OperationMemory;
            }
		}
		global.logger.debug("Saved Operations: " + Object.keys(Memory.empire.operations).length);
	}

	public generateName(): string {
        return Math.random().toString(36).substr(8);
    }


    /**
     * push a new RoomOperation into the operations List of the RoomManager
     * @param entry RoomOperation
     */
    public enque(entry: OperationMemory){
		const name = this.generateName();
		this.operations[name]=new OP_STORAGE[entry.type](this, entry as OperationMemory);
		global.logger.debug(" ADDED Operation: " + name + " of Type: " + entry.type + " data: " + entry.data);

		return name;
	}
	
    /**
     * remove a new RoomOperation from the operations List of the RoomManager
     * @param entry RoomOperationMemoryInterface
     */

	public entryExists(name: string ){
		return this.operations[name] != null;
	}

    public dequeue(name: string){
       delete this.operations[name];
    }
}