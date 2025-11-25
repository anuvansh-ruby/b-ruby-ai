module.exports = {
    apps: [
        {
            name: "b_ruby_ai_app",        // Name shown in PM2 list
            script: "src/index.js",           // Your main entry file
            instances: 1,                  // Or 'max' to use all cores
            exec_mode: "fork",             // Or 'cluster' for load balancing
            watch: false,                  // Change to true for dev mode
            env: {
                NODE_ENV: "development"
            },
            env_production: {
                NODE_ENV: "production",
                PORT: 8500
            }
        }
    ]
};
