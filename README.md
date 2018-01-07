Thanks to bonzaiferroni for his typescript starter kit!


JobManager:
 - Executes Jobs in order of highest priority
 - Saves not completed job to memory each tick including their needed data
 - laods all Jobs from memory each tick in the internal JobList
 - Creates the InitJob on Initialisation
 
Job:
 - All Jobs derive from this
 - Handles Creation of the job and all needed paramters
 - provides baseline function as _complete()_ to indicate the job is finished
 
RoomManager:
 - Job which is executed on all Rooms in Memory.myRooms
 - Manages spawning of other jobs like miners, haulers, structure building, defense code
 etc
 - Rooms below level 4 run only the InitialBuildUp Job, to get them to level 4 with tower
 and a Storage
 -If Storage is set, the Different Jobs will spawn, Miner Jobs, Hauler Jobs, Supply Jobs 
 And Builders/repair on demand


