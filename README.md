# RKE2 Cloud Deploy
This repo consists of 4 distinct components, each that are their own cdk app or repo. 

1. ec2-imagebuilder-component -> This creates an EC2 ImageBuilder pipeline from the parameters in config.json (provided in a different repo) with the component file in assets/ (also in another repo). I handles failures and creation of new AMIs via codepipeline and codebuild.
2. rke2-ami-ansible -> This repo holds the ansible code for creating rke2 cluster. It also holds a python script for intial cluster discovery and leader election, as well as the config.json and component file needed for the repo mentioned above.
3. core-cdk -> This repo hosts all of the resources besides the rke2 nodes. This means the VPC, the tailscale server for remote access, the NLB for loadbalancing of the cluster, and the EFS filesystem for the storage backend. It is seperate so that core infrastructure is not disrupted when the k8s nodes are updated.
4. rke2-asg-cdk -> This repo hosts the cdk code to deploy the rke2 autoscaling group. It hooks the servers up to the EFS share, the NLB, and the aforementioned resources.

Together, these resources come together to create a functioning rke2 cluster.

Versioning:

Currently, my rke2 cluster is using version kubernetes 1.33. I will try my best to update that once a new stable version comes out. 
My cluster also deploys rancher web ui 2.11.2 and argocd 3.0.6
More applications will be deployed as time goes on. 
