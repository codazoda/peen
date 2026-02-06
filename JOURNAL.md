# Journal

I used the following as the first prompt I tested.

> Build me a bash script, call it hello.sh, and use it to tell the world hello.

I used qwen3-coder:30b (quantized) to run the following prompt.

> Create a evaluate.js script. This is a node program. It will be a command line program. Our program should create a map of the source code project in the current directory. We want the program to output a map.txt file that lists all the files in the current directory in a `tree` (command) like list. Sort the list so that directories are listed last, at the bottom of the tree, recursively. Search each file for any lines that start with `function` or `func` and include those, as if they were also files in the tree. Write minimal, readable code. DO NOT USE A FRAMEWORK. Minimize dependencies as much as possible.

I used qwen3-coder:7b to run the following prompt.

> I want to create a VPN service. I want it to run in a docker container. It should use alpine:latest. It should store logs in a seperate mount. The mount should go on a RAM disk so that it's temporary and the logs die on power down or reboot.
