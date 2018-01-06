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
 - 
